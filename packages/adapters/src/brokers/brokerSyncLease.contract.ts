import { expect, test } from "vitest";
import type { BrokerAccountSnapshot } from "./brokerSnapshot.js";
import type {
  BrokerSyncOperationStore,
  BrokerSyncProgressRecord,
  BrokerSyncState,
  ScheduledBroker,
} from "./scheduledSync.js";

const BROKER: ScheduledBroker = "trading212";
const at = (milliseconds: number) => new Date(milliseconds).toISOString();
const running = (leaseId: string, updatedAt = at(1_000)): BrokerSyncProgressRecord => ({
  status: "running",
  message: null,
  updatedAt,
  leaseId,
});
const cursor = (lastSyncedAt: string | null): BrokerSyncState => ({
  lastSyncedAt,
  retryAfter: null,
});
const held: BrokerAccountSnapshot = { positions: [], trades: [], dividends: [] };

type CreateStore = () => BrokerSyncOperationStore | Promise<BrokerSyncOperationStore>;

/** Run identical observable lease behavior against memory, file and SQL backed stores. */
export function brokerSyncLeaseContract(name: string, createStore: CreateStore) {
  test(`${name}: a fresh owner blocks a second claim and a foreign write`, async () => {
    const store = await createStore();
    const first = await store.claim(BROKER, {
      leaseId: "first",
      staleBefore: at(0),
      progress: running("first"),
    });
    expect(first.claimed).toBe(true);

    const second = await store.claim(BROKER, {
      leaseId: "second",
      staleBefore: at(500),
      progress: running("second", at(2_000)),
    });
    expect(second.claimed).toBe(false);
    expect(await store.publish(BROKER, "second", running("second"))).toBe(false);
    expect(
      await store.commit(BROKER, {
        leaseId: "second",
        credentialGeneration: second.credentialGeneration,
        state: cursor(at(2_000)),
        progress: running("second"),
        data: null,
      }),
    ).toBe(false);
    expect((await store.get(BROKER)).lastSyncedAt ?? null).toBeNull();
    expect(await store.progress(BROKER)).toMatchObject({ leaseId: "first" });
  });

  test(`${name}: a stale lease is taken over and the old owner's commit is refused`, async () => {
    const store = await createStore();
    await store.claim(BROKER, { leaseId: "first", staleBefore: at(0), progress: running("first") });

    const second = await store.claim(BROKER, {
      leaseId: "second",
      staleBefore: at(10_000),
      progress: running("second", at(40_000)),
    });
    expect(second.claimed).toBe(true);

    expect(
      await store.commit(BROKER, {
        leaseId: "first",
        credentialGeneration: second.credentialGeneration,
        state: cursor(at(5_000)),
        progress: running("first"),
        data: null,
      }),
    ).toBe(false);
    expect(
      await store.commit(BROKER, {
        leaseId: "second",
        credentialGeneration: second.credentialGeneration,
        state: cursor(at(40_000)),
        progress: running("second"),
        data: null,
      }),
    ).toBe(true);
    expect((await store.get(BROKER)).lastSyncedAt).toBe(at(40_000));
  });

  test(`${name}: a heartbeat at the cutoff is live, one millisecond older is stale`, async () => {
    const store = await createStore();
    await store.claim(BROKER, { leaseId: "first", staleBefore: at(0), progress: running("first") });

    const tie = await store.claim(BROKER, {
      leaseId: "second",
      staleBefore: at(1_000),
      progress: running("second", at(9_000)),
    });
    expect(tie.claimed).toBe(false);

    const past = await store.claim(BROKER, {
      leaseId: "third",
      staleBefore: at(1_001),
      progress: running("third", at(9_000)),
    });
    expect(past.claimed).toBe(true);
  });

  test(`${name}: a commit releases the lease so the next claim reads its cursor`, async () => {
    const store = await createStore();
    const first = await store.claim(BROKER, {
      leaseId: "first",
      staleBefore: at(0),
      progress: running("first"),
    });
    expect(
      await store.commit(BROKER, {
        leaseId: "first",
        credentialGeneration: first.credentialGeneration,
        state: cursor(at(5_000)),
        progress: running("first"),
        data: null,
      }),
    ).toBe(true);

    const second = await store.claim(BROKER, {
      leaseId: "second",
      staleBefore: at(0),
      progress: running("second", at(9_000)),
    });
    expect(second.claimed).toBe(true);
    expect(second.state.lastSyncedAt).toBe(at(5_000));
  });
}

export type BrokerSyncCommitOptions = {
  /** A store that models credential generations refuses a commit whose
   *  generation has moved on. A store that resets the broker on reconnect
   *  guards the same case with its lease, so it does not opt in. */
  enforcesCredentialGeneration?: boolean;
};

/** The broker store's extra guarantees: atomic cursor + data, release, generation. */
export function brokerSyncCommitContract(
  name: string,
  createStore: CreateStore,
  options: BrokerSyncCommitOptions = {},
) {
  test(`${name}: commit stores the cursor and the broker data together`, async () => {
    const store = await createStore();
    const claim = await store.claim(BROKER, {
      leaseId: "run",
      staleBefore: at(0),
      progress: running("run"),
    });
    expect(
      await store.commit(BROKER, {
        leaseId: "run",
        credentialGeneration: claim.credentialGeneration,
        state: cursor(at(5_000)),
        progress: running("run"),
        data: held,
      }),
    ).toBe(true);

    const next = await store.claim(BROKER, {
      leaseId: "next",
      staleBefore: at(0),
      progress: running("next", at(9_000)),
    });
    expect(next.claimed).toBe(true);
    expect(next.state.lastSyncedAt).toBe(at(5_000));
    expect(next.data).toEqual(held);
  });

  test(`${name}: a run that lost the lease writes neither cursor nor data`, async () => {
    const store = await createStore();
    const claim = await store.claim(BROKER, {
      leaseId: "first",
      staleBefore: at(0),
      progress: running("first"),
    });
    await store.claim(BROKER, {
      leaseId: "second",
      staleBefore: at(10_000),
      progress: running("second", at(40_000)),
    });

    expect(
      await store.commit(BROKER, {
        leaseId: "first",
        credentialGeneration: claim.credentialGeneration,
        state: cursor(at(5_000)),
        progress: running("first"),
        data: held,
      }),
    ).toBe(false);

    const next = await store.claim(BROKER, {
      leaseId: "third",
      staleBefore: at(50_000),
      progress: running("third", at(60_000)),
    });
    expect(next.claimed).toBe(true);
    expect(next.state.lastSyncedAt ?? null).toBeNull();
    expect(next.data).toBeNull();
  });

  test(`${name}: release clears the lease and keeps the cursor`, async () => {
    const store = await createStore();
    const seed = await store.claim(BROKER, {
      leaseId: "seed",
      staleBefore: at(0),
      progress: running("seed"),
    });
    await store.commit(BROKER, {
      leaseId: "seed",
      credentialGeneration: seed.credentialGeneration,
      state: { lastSyncedAt: null, retryAfter: null, resume: { ordersNextPagePath: "page-3" } },
      progress: running("seed"),
      data: null,
    });

    await store.claim(BROKER, {
      leaseId: "run",
      staleBefore: at(0),
      progress: running("run", at(9_000)),
    });
    await store.release(BROKER, "run", {
      status: "problem",
      message: "rate-limited",
      updatedAt: at(9_500),
      leaseId: "run",
    });

    const next = await store.claim(BROKER, {
      leaseId: "next",
      staleBefore: at(0),
      progress: running("next", at(10_000)),
    });
    expect(next.claimed).toBe(true);
    expect(next.state.resume).toEqual({ ordersNextPagePath: "page-3" });
  });

  if (options.enforcesCredentialGeneration) {
    test(`${name}: a commit from a credential generation that moved on is refused`, async () => {
      const store = await createStore();
      const claim = await store.claim(BROKER, {
        leaseId: "run",
        staleBefore: at(0),
        progress: running("run"),
      });
      expect(
        await store.commit(BROKER, {
          leaseId: "run",
          credentialGeneration: claim.credentialGeneration + 1,
          state: cursor(at(5_000)),
          progress: running("run"),
          data: held,
        }),
      ).toBe(false);
      expect(
        await store.commit(BROKER, {
          leaseId: "run",
          credentialGeneration: claim.credentialGeneration,
          state: cursor(at(5_000)),
          progress: running("run"),
          data: held,
        }),
      ).toBe(true);
    });
  }
}
