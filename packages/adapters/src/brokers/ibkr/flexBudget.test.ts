import { DateTime } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { setHttpFetchTransport } from "../../../vendor/gloomberb/http-transport.js";
import {
  createFailingPartnerBudget,
  createImmediatePartnerBudget,
} from "../../partnerBudget/fakes.js";
import { PartnerBudgetUnavailable, PartnerWait } from "../../partnerBudget/PartnerBudget.js";
import { createIbkrFlexAdapter } from "./flexAdapter.js";
import { loadFlexStatement, requestFlexStatement } from "./flexStatementClient.js";

/* How the IBKR Flex client uses the PartnerBudget: one key per token for the
 * request and every poll, and a pause, not a send, when the budget says no. */

const ENDPOINT =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
const SENT = "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>";
const STATEMENT = "<FlexStatements><FlexStatement></FlexStatement></FlexStatements>";
const base = { token: "secret-flex-token", queryId: "12345", endpoint: ENDPOINT };

afterEach(() => {
  setHttpFetchTransport(null);
  vi.restoreAllMocks();
});

test("SendRequest and every GetStatement poll take a slot of the same ibkr:flex key", async () => {
  let polls = 0;
  const urls: string[] = [];
  setHttpFetchTransport(async (url) => {
    urls.push(url);
    if (url.includes("SendRequest")) return new Response(SENT);
    polls += 1;
    return new Response(
      polls < 3
        ? "<FlexStatementResponse>Statement generation in progress</FlexStatementResponse>"
        : STATEMENT,
    );
  });
  const budget = createImmediatePartnerBudget();
  await loadFlexStatement({
    ...base,
    partnerBudget: budget,
    initialWaitMs: 0,
    pollDelayMs: 1,
    deadlineMs: Date.now() + 600_000,
  });
  expect(urls).toHaveLength(4);
  expect(budget.calls).toHaveLength(4);
  const [first, ...rest] = budget.calls;
  expect(first!.key.partner).toBe("ibkr");
  expect(first!.key.endpoint).toBe("flex");
  expect(first!.key.scopeId).toMatch(/^[0-9a-f]{16}$/);
  expect(JSON.stringify(first!.key)).not.toContain("secret-flex-token");
  for (const call of rest) expect(call.key).toEqual(first!.key);
  expect(budget.calls.every((call) => call.call === "awaitSlot")).toBe(true);
  expect(
    budget.calls.every((call) => (call as { deadlineMs?: number }).deadlineMs !== undefined),
  ).toBe(true);
});

test("a slot after the deadline sends nothing and reports the existing deadline problem", async () => {
  const transport = vi.fn(async () => new Response(SENT));
  setHttpFetchTransport(transport);
  const budget = createFailingPartnerBudget(
    new PartnerWait({ until: DateTime.makeUnsafe(Date.now() + 60_000) }),
  );
  await expect(requestFlexStatement({ ...base, partnerBudget: budget })).rejects.toThrow(
    "IBKR Flex sync paused before the host time limit; retry on the next sync",
  );
  expect(transport).not.toHaveBeenCalled();
});

test("a budget store that is down sends nothing and the adapter reports a pause, not a success", async () => {
  const transport = vi.fn(async () => new Response(SENT));
  setHttpFetchTransport(transport);
  const adapter = createIbkrFlexAdapter({
    ...base,
    partnerBudget: createFailingPartnerBudget(new PartnerBudgetUnavailable({ message: "down" })),
  });
  const result = await adapter.sync({ lanes: ["holdings", "history"], entity: "BV" });
  expect(transport).not.toHaveBeenCalled();
  expect(result.problems).toEqual([
    "IBKR Flex sync paused: the shared request budget is unavailable; retry on the next sync",
  ]);
  expect(result.sections.positions.status).toBe("unavailable");
  expect(result.retryAfter).toBeUndefined();
});

test("two tokens do not share a budget key", async () => {
  setHttpFetchTransport(async () => new Response(SENT));
  const budget = createImmediatePartnerBudget();
  await requestFlexStatement({ ...base, token: "token-a", partnerBudget: budget });
  await requestFlexStatement({ ...base, token: "token-b", partnerBudget: budget });
  expect(budget.calls[0]!.key.scopeId).not.toBe(budget.calls[1]!.key.scopeId);
});
