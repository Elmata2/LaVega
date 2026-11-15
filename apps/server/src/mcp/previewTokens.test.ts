import { expect, test } from "vitest";
import { createRulePreviewStore } from "./previewTokens.js";

/* WS5.4 (#299): a preview token is single-use, bound to the identity that asked,
 * and expires after the plan's 30 minutes. */

const entries = [{ broker: "trading212", account: "ISA", wrapper: "isa" as const }];
const changes = [{ broker: "trading212", account: "ISA", from: "unknown", to: "isa" }];

test("a preview token is consumed once and only by its own identity", () => {
  const store = createRulePreviewStore();
  const issued = store.issue({
    tenantId: "user-1",
    tokenId: "env-write",
    entries,
    changes,
    now: 1_000,
  });

  expect(
    store.consume({
      previewToken: issued.previewToken,
      tenantId: "user-2",
      tokenId: "env-write",
      now: 2_000,
    }),
  ).toBeNull();
  // The mismatched attempt spent the token, so a leaked token cannot be probed.
  expect(
    store.consume({
      previewToken: issued.previewToken,
      tenantId: "user-1",
      tokenId: "env-write",
      now: 2_000,
    }),
  ).toBeNull();
});

test("a preview token expires after 30 minutes", () => {
  const store = createRulePreviewStore();
  const issued = store.issue({
    tenantId: "user-1",
    tokenId: "env-write",
    entries,
    changes,
    now: 1_000,
  });
  expect(Date.parse(issued.expiresAt) - 1_000).toBe(30 * 60 * 1000);
  expect(
    store.consume({
      previewToken: issued.previewToken,
      tenantId: "user-1",
      tokenId: "env-write",
      now: 1_000 + 30 * 60 * 1000,
    }),
  ).toBeNull();
});

test("a live token returns the validated payload and changes", () => {
  const store = createRulePreviewStore();
  const issued = store.issue({
    tenantId: "user-1",
    tokenId: "env-write",
    entries,
    changes,
    now: 1_000,
  });
  const stored = store.consume({
    previewToken: issued.previewToken,
    tenantId: "user-1",
    tokenId: "env-write",
    now: 2_000,
  });
  expect(stored).toMatchObject({ tenantId: "user-1", entries, changes });
});
