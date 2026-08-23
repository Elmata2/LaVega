import type { CashBalance, CashFlow, Dividend, Position, Trade } from "@lavega/core";

/* The shape of a broker snapshot, and nothing else.
 *
 * It used to live in fileCredentialStore.ts, next to the code that persists it.
 * That reads naturally and broke the import boundary: devFixture.ts needs only the
 * TYPE, but `import type { RuntimeBrokerDataSnapshot } from "./fileCredentialStore.js"`
 * is still an edge in the module graph, so the request path — which reaches
 * devFixture — was flagged for pulling node:fs and node:fs/promises through it.
 *
 * The import is erased at runtime and could never actually have loaded fs, so this
 * was a false positive. It was still worth fixing HERE rather than teaching the
 * boundary check to ignore type-only edges: a type describing broker data does not
 * belong to the file that happens to write it to disk, and the check stays strict
 * for the case it exists to catch.
 */
export type RuntimeBrokerDataSnapshot = Partial<
  Record<
    "ibkr" | "trading212",
    {
      positions: Position[];
      trades: Trade[];
      dividends: Dividend[];
      cashBalances?: CashBalance[];
      cashFlows?: CashFlow[];
    }
  >
>;
