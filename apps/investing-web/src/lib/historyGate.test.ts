import { expect, test } from "vitest";
import { brokerLabel, historyGate, type BrokerHistory } from "./historyGate";

const complete: BrokerHistory = {
  lastSyncedAt: "2026-09-22T10:00:00.000Z",
  ordersComplete: true,
  transactionsComplete: true,
  dividendsComplete: true,
};
const midFirstSync: BrokerHistory = {
  lastSyncedAt: null,
  ordersComplete: false,
  transactionsComplete: false,
  dividendsComplete: false,
};

/* DIT IS HET GEVAL DAT HET UITMAAKT. Een eerste synchronisatie die nog loopt
 * levert een willekeurig deel van de geschiedenis op, en rendement wordt uit
 * `trades` gerekend — dus het getal is niet onvolledig maar fout, en het staat
 * er met twee decimalen bij alsof dat niet zo is. */
test("a first sync that has not finished withholds the figures", () => {
  expect(historyGate({ trading212: midFirstSync })).toEqual({
    kind: "first-sync",
    brokers: ["trading212"],
  });
});

/* ÉÉN ONAFGEMAAKTE PAGINERING IS GENOEG. Orders volledig maar dividenden niet
 * is nog steeds een halve geschiedenis. */
test("any one unfinished section is enough to hold the figures back", () => {
  expect(
    historyGate({
      trading212: { ...midFirstSync, ordersComplete: true, transactionsComplete: true },
    }).kind,
  ).toBe("first-sync");
});

/* EN DE ANDERE KANT OP, want een poort die nooit opengaat is net zo fout.
 * `lastSyncedAt` schuift alleen op als er geen cursor overblijft, dus een
 * gevulde waarde bewijst dat er ooit een volledige stand was. Samenvoegen gaat
 * op id, dus wat er nu ligt is die stand plus nieuwe rijen — een superset. */
test("a resumed sync after a complete one shows, and says it is updating", () => {
  expect(historyGate({ trading212: { ...midFirstSync, lastSyncedAt: "2026-09-01T00:00:00Z" } })).toEqual(
    { kind: "ready", updating: ["trading212"] },
  );
});

test("everything complete is simply ready", () => {
  expect(historyGate({ trading212: complete, ibkr: complete })).toEqual({
    kind: "ready",
    updating: [],
  });
});

/* Een broker die nog nooit iets deed heeft geen cursor openstaan, dus hij houdt
 * het scherm niet tegen — anders zou de lege staat nooit te zien zijn. */
test("a broker that never ran does not hold the screen", () => {
  expect(
    historyGate({
      ibkr: { lastSyncedAt: null, ordersComplete: true, transactionsComplete: true, dividendsComplete: true },
    }),
  ).toEqual({ kind: "ready", updating: [] });
});

/* Eén broker mag de ander niet gijzelen zodra die ooit compleet was — maar een
 * eerste sync die loopt houdt het scherm wel tegen, want de cijfers tellen over
 * beide brokers op. */
test("a first sync on one broker holds the screen even when the other is done", () => {
  expect(historyGate({ ibkr: complete, trading212: midFirstSync })).toEqual({
    kind: "first-sync",
    brokers: ["trading212"],
  });
});

test("no history at all is not a reason to block", () => {
  expect(historyGate(null)).toEqual({ kind: "ready", updating: [] });
  expect(historyGate(undefined)).toEqual({ kind: "ready", updating: [] });
});

test("brokers are named the way people write them", () => {
  expect(brokerLabel("trading212")).toBe("Trading 212");
  expect(brokerLabel("ibkr")).toBe("Interactive Brokers");
});
