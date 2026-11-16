// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, CatalogueEntryLike, CatalogValue, Tx } from "@lavega/core";
import { makeFact, ownAccounts, TRAVEL_AGENT } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";
import type { StatedAnswers } from "./plan/optimalisatieStated";

/* Optimalisatie reads the intake wizard's card answers. Connected data always
 * beats them; a stated card is a held row with unknown cashback and never the
 * baseline of a euro gain claim. */

const acc = (over: Partial<Account>): Account => ({
  key: "k",
  iban: "",
  name: "Rekening",
  bank: "ING",
  entity: "BV1",
  currency: "EUR",
  balance: 1000,
  ...over,
});
const spend = (key: string, month: number): Tx => ({
  id: key + month,
  accountKey: key,
  date: `2025-${String(month).padStart(2, "0")}-15`,
  amount: -2500,
  currency: "EUR",
  counterparty: "Albert Heijn",
  description: "",
  category: "",
  manual: false,
});
const TXS = (key: string) => Array.from({ length: 12 }, (_, i) => spend(key, i + 1));

const field = (value: unknown): CatalogValue =>
  ({
    value,
    route: "provider-page",
    sourceUrl: "https://example.test/x",
    checkedAt: "2026-08-01",
    conditions: null,
    conditionsKnown: true,
  }) as unknown as CatalogValue;

const MARKET_CARD: CatalogueEntryLike = {
  id: "market-card",
  product: "Marktkaart",
  issuer: "Testbank N.V.",
  kind: "creditcard",
  fields: {
    cashbackPct: field(2),
    pointsPerEuro: field(0),
    accountFee: { ...field(0), period: "jaar" } as never,
  },
};
const AMEX: CatalogueEntryLike = {
  id: "american-express-gold-card",
  product: "American Express Gold Card",
  issuer: "American Express",
  kind: "creditcard",
  fields: { accountFee: { ...field(100), period: "jaar" } as never },
};
const INVEST: CatalogueEntryLike = {
  id: "trading-212-beleggingsrekening",
  product: "Trading 212 Beleggingsrekening",
  issuer: "Trading 212",
  kind: "beleggingsrekening",
  fields: {},
};
const ENTRIES = [MARKET_CARD, AMEX, INVEST];

const ING = acc({ key: "ing", bank: "ING", balance: 20_000, interestRate: 1.5 });
const SAVINGS = acc({ key: "spaar", bank: "ABN AMRO", name: "Spaarrekening", balance: 50_000 });
const T212 = acc({ key: "t212", bank: "Trading 212", balance: 0 });

const FACTS = [
  makeFact({
    agent: TRAVEL_AGENT,
    subject: "Trading 212 betaalpas",
    key: "cashbackPct",
    value: "1.5",
    source: "agent",
    updatedAt: "2026-08-18",
  }),
  makeFact({
    agent: TRAVEL_AGENT,
    subject: "ING betaalpas",
    key: "cashbackPct",
    value: "0",
    source: "agent",
    updatedAt: "2026-08-18",
  }),
];

const answers = (o: Partial<StatedAnswers> = {}): StatedAnswers => ({
  credit: [AMEX.id],
  debit: [],
  repayment: "full",
  balances: [],
  noCards: false,
  statedAt: "2026-11-01",
  ...o,
});

const render = (props: Partial<Parameters<typeof Optimalisatie>[0]> = {}) => {
  const accounts = props.accounts ?? [ING, T212];
  return renderToStaticMarkup(
    <Optimalisatie
      txs={TXS("ing")}
      accounts={accounts}
      rules={[]}
      own={ownAccounts(accounts)}
      asOf="2026-01-15"
      busy={false}
      entries={ENTRIES}
      facts={FACTS}
      onRateCommit={() => {}}
      {...props}
    />,
  );
};

const row = (html: string, testid: string): string => {
  const m = html.match(new RegExp(`data-testid="${testid}"[^>]*>([\\s\\S]*?)</p>`));
  if (!m) throw new Error(`no line with data-testid="${testid}"`);
  return m[1]!.replace(/<[^>]+>/g, "");
};

const bare = (html: string) =>
  html.replace(/<p[^>]*data-testid="optimalisatie-disclaimer"[\s\S]*?<\/p>/, "");

test("without the stated prop the page is as before, plus the disclaimer", () => {
  const html = render();
  expect(html).not.toContain('data-testid="stated-badge"');
  expect(html).toContain('data-testid="optimalisatie-disclaimer"');
  expect(html).toContain("Het is geen financieel advies");
  expect(html).toContain("Betaal met <strong>Trading 212</strong> in plaats van ING");
});

test("a stated-only card: badge, unknown cashback, no gain figure, an invite line", () => {
  const html = render({
    accounts: [SAVINGS],
    txs: [],
    stated: answers(),
  });
  expect(html).toContain('data-testid="stated-badge"');
  expect(html).toContain("volgens je antwoorden");
  expect(html).toContain("opgegeven op");
  expect(html).toContain("American Express Gold Card");
  expect(html).toContain("cashback onbekend");
  expect(html).not.toContain('data-testid="cashback-antwoord"');
  expect(html).not.toContain("per jaar meer");
  expect(html).not.toMatch(/American Express Gold Card<\/strong> — [^<]*0%/);
  const invite = html.match(/data-testid="cashback-stated-invite"[^>]*>([^<]*)</);
  expect(invite?.[1]).toContain("kent LaVega je uitgaven niet");
  expect(invite?.[1]).toContain("American Express Gold Card");
  const block = html.match(/<section[^>]*aria-label="Cashback"[\s\S]*?<\/section>/)![0];
  expect(block).not.toMatch(/€/);
  // The market options are still there, without a gain figure.
  expect(html).toContain("Marktkaart");
});

test("mixed: the comparison is limited to what LaVega sees, and the invite sits under it, outside any fold", () => {
  const html = render({ stated: answers() });
  const line = html.match(/data-testid="cashback-antwoord"[^>]*>([^<]*)</)![1]!;
  expect(line).toContain("van de kaarten die LaVega in je rekeningen ziet");
  expect(line).not.toContain("je beste eigen kaart");
  expect(html).toContain("Betaal met <strong>Trading 212</strong> in plaats van ING");
  const box = document.createElement("div");
  box.innerHTML = html;
  const invite = box.querySelector('[data-testid="cashback-stated-invite"]')!;
  expect(invite).not.toBeNull();
  expect(invite.closest("details")).toBeNull();
  const answerEl = box.querySelector('[data-testid="cashback-antwoord"]')!;
  expect(answerEl.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(box.querySelectorAll('[data-testid="cashback-stated-invite"]')).toHaveLength(1);
  expect(html).toContain('data-testid="stated-badge"');
});

test("without a stated card the answer keeps its wording", () => {
  const html = render({ stated: answers({ credit: [] }) });
  expect(html).toContain("op je beste eigen kaart");
});

test("once the card is connected it is a normal held row: no badge", () => {
  const amex = acc({
    key: "amex",
    bank: "American Express",
    name: "American Express Gold Card",
    type: "Creditcard",
  });
  const html = render({ accounts: [ING, amex], stated: answers() });
  expect(html).not.toContain('data-testid="stated-badge"');
  expect(html).not.toContain("cashback-stated-invite");
});

test("not a payment card: other and investment accounts are not rows", () => {
  const html = render({
    accounts: [SAVINGS],
    txs: [],
    stated: answers({ credit: ["other", INVEST.id] }),
  });
  expect(html).not.toContain('data-testid="stated-badge"');
  expect(html).not.toContain("Trading 212 Beleggingsrekening");
});

test("the disclaimer is the shell's text, once", () => {
  const html = render({ stated: answers() });
  const matches = html.match(/Het is geen financieel advies/g) ?? [];
  expect(matches).toHaveLength(1);
  expect(html).toContain('data-testid="optimalisatie-disclaimer"');
});

test("card debt: no switch offer anywhere, one calm factual note", () => {
  const html = render({ stated: answers({ repayment: "sometimes" }) });
  const body = bare(html);
  expect(body).not.toContain('data-testid="cashback-antwoord"');
  expect(body).not.toContain("Betaal met <strong>Trading 212</strong>");
  expect(body).not.toContain("Andere kaarten");
  expect(html).toContain('data-testid="cashback-debt"');
  expect(html).toContain("Je gaf aan dat je je creditcard niet altijd volledig aflost.");
  expect(html).toContain("kan de rente zwaarder wegen dan cashback");
  expect(html).not.toContain("Je laat een saldo");
  expect(body).not.toMatch(/advies|adviseur/i);
});

test("an unpaid stated balance is card debt too", () => {
  const html = render({
    stated: answers({
      repayment: "full",
      balances: [{ cardId: AMEX.id, balanceCents: 50_000, paysInFull: false }],
    }),
  });
  expect(html).toContain('data-testid="cashback-debt"');
});

test("an unpaid stated balance is named as a balance, not as the repayment answer", () => {
  const html = render({
    stated: answers({
      repayment: "full",
      balances: [{ cardId: AMEX.id, balanceCents: 50_000, paysInFull: false }],
    }),
  });
  expect(html).toContain("Je gaf een openstaand saldo op je creditcard aan.");
});

/* ── F: the invite leads somewhere ─────────────────────────────────────── */

test("the invite links to Rekeningen when the app can navigate", () => {
  const html = render({
    accounts: [SAVINGS],
    txs: [],
    stated: answers(),
    onOpenAccounts: () => {},
  });
  const box = document.createElement("div");
  box.innerHTML = html;
  const invite = box.querySelector('[data-testid="cashback-stated-invite"]')!;
  expect(invite.querySelector("button")?.textContent).toBe("Naar Rekeningen");
});

/* ── G: scope, debit, euro-free ───────────────────────────────────────── */

test("the business half reads none of it: no rows, invite, first-card or debt note", () => {
  const html = render({
    entityScope: "business",
    stated: answers({ repayment: "sometimes", credit: [AMEX.id] }),
  });
  expect(html).not.toContain('data-testid="stated-badge"');
  expect(html).not.toContain("cashback-stated-invite");
  expect(html).not.toContain("cashback-first-card");
  expect(html).not.toContain("cashback-debt");
  const none = render({
    entityScope: "business",
    accounts: [SAVINGS],
    txs: [],
    stated: answers({ credit: [], noCards: true }),
  });
  expect(none).not.toContain("cashback-first-card");
});

test("a stated debit card shows a badge, and is gone once a live bank link carries it", () => {
  const ENT = [...ENTRIES, ING_DEBIT];
  const stated = answers({ credit: [], debit: [ING_DEBIT.id] });
  const before = render({ accounts: [SAVINGS], txs: [], entries: ENT, stated });
  expect(before).toContain('data-testid="stated-badge"');
  const linked = acc({ key: "ing", bank: "ING", name: "Betaalrekening", linkedAt: "2026-11-01" });
  const after = render({ accounts: [SAVINGS, linked], txs: [], entries: ENT, stated });
  expect(after).not.toContain('data-testid="stated-badge"');
});

/* ── B, C: a first CREDIT card ─────────────────────────────────────────── */

const ING_DEBIT: CatalogueEntryLike = {
  id: "ing-betaalpas",
  product: "ING Betaalpas",
  issuer: "ING",
  kind: "betaalpas",
  fields: {},
};

/** Spend on the 2nd of each of the last `n` months before asOf (2026-01-15),
 *  on an account whose balance date covers to the end of each month. */
const monthsOfSpend = (key: string, n: number): Tx[] =>
  Array.from({ length: n }, (_, i) => {
    const month = 12 - n + 1 + i;
    return { ...spend(key, month), date: `2025-${String(month).padStart(2, "0")}-02` };
  });
const noProvider = (over: Partial<Account> = {}) =>
  acc({
    key: "geen",
    bank: "",
    name: "Betaalrekening",
    type: "Betaalrekening",
    balanceDate: "2026-01-10",
    ...over,
  });
const noCredit = answers({ credit: [], noCards: true });

test("no credit card and no spend at all: names the credit card, never 'geen kaart'", () => {
  const html = render({ accounts: [SAVINGS], txs: [], stated: noCredit });
  const line = row(html, "cashback-first-card");
  expect(line).toContain("Je hebt geen creditcard.");
  expect(line).not.toContain("geen kaart");
  expect(html).not.toContain("even goed of beter");
});

test("two full months: no euro figure and no verdict, an honest too-little line", () => {
  const html = render({
    accounts: [noProvider()],
    txs: monthsOfSpend("geen", 2),
    stated: noCredit,
  });
  const line = row(html, "cashback-first-card");
  expect(line).toContain("LaVega heeft nog te weinig maanden aan uitgaven om dit uit te rekenen.");
  expect(line).not.toMatch(/€|loont nu niet|kan lonen/);
});

test("three full months: the first credit card is priced net of its fee", () => {
  const html = render({
    accounts: [noProvider()],
    txs: monthsOfSpend("geen", 3),
    stated: noCredit,
  });
  const line = row(html, "cashback-first-card");
  expect(line).toContain("Een eerste creditcard kan lonen");
  expect(line).toContain("Marktkaart");
  expect(line).toMatch(/€/);
});

test("a card that cannot clear the plan's threshold: says so plainly", () => {
  const dear: CatalogueEntryLike = {
    ...MARKET_CARD,
    fields: { ...MARKET_CARD.fields, accountFee: { ...field(900), period: "jaar" } as never },
  };
  const html = render({
    accounts: [noProvider()],
    txs: monthsOfSpend("geen", 4),
    entries: [dear, AMEX],
    stated: noCredit,
  });
  const line = row(html, "cashback-first-card");
  expect(line).toContain("een creditcard nemen loont nu niet");
  expect(line).toContain("€\u00a020,00");
});

test("a debit card only, and 'geen creditcard': credit wording", () => {
  const html = render({
    accounts: [SAVINGS],
    txs: [],
    entries: [...ENTRIES, ING_DEBIT],
    stated: answers({ credit: [], debit: [ING_DEBIT.id], noCards: true }),
  });
  expect(row(html, "cashback-first-card")).toContain("Je hebt geen creditcard.");
  expect(html).not.toContain("geen kaart");
});

test("a connected current account does not suppress the first-credit-card line", () => {
  const html = render({
    accounts: [ING, T212],
    txs: TXS("ing"),
    stated: noCredit,
  });
  expect(row(html, "cashback-first-card")).toContain("Je hebt geen creditcard.");
  expect(html).not.toContain("even goed of beter");
});

test("a connected credit card means the framing does not apply", () => {
  const amex = acc({
    key: "amex",
    bank: "American Express",
    name: "American Express Gold Card",
    type: "Creditcard",
  });
  const html = render({ accounts: [ING, amex], stated: noCredit });
  expect(html).not.toContain("cashback-first-card");
});
