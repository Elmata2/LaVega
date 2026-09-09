import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { formatEuro } from "../../format.js";
import PositieBlock from "./PositieBlock";
import { accounts, ASOF } from "./fixtures";

/** Today's default and every existing test's mode: a non-EUR balance is left
 *  out exactly as it always was, never converted. */
const SEPARATE = { fxHistory: {}, mode: "separate" as const };

test("PositieBlock renders one compact row per entity in a small card", () => {
  const html = renderToStaticMarkup(
    <PositieBlock accounts={accounts} onNavigate={() => {}} asOf={ASOF} {...SEPARATE} />,
  );
  expect(html).toContain("Positie");
  expect(html).toContain("Holding BV");
  expect(html).toContain("Café BV");
  expect(html).toContain("Webshop BV");
  expect(html).toContain(formatEuro(182_310));
  expect(html).toContain(formatEuro(21_900));
  expect(html).toContain("proportion-bar");
  // Shrunk: the per-entity sparkline is gone, and so is the tall card.
  expect(html).toContain("module-short");
  expect(html).not.toContain("module-tall");
  expect(html).not.toContain("sparkline");
});

test("PositieBlock leaves an entity's position unknown when one saldo is missing", () => {
  const html = renderToStaticMarkup(
    <PositieBlock accounts={accounts} onNavigate={() => {}} asOf={ASOF} {...SEPARATE} />,
  );
  // Webshop BV's only account has no saldo, so its position is unknown rather
  // than a partial sum or a zero.
  expect(html).toContain("onbekend");
  expect(html).toContain("1 bedrijf zonder compleet saldo");
  expect(html).not.toContain(formatEuro(0));
});

test("PositieBlock leaves an entity's position unknown when a balance isn't in EUR", () => {
  // Same Enable Banking pocket-per-currency shape as SaldoBlock's repro: a
  // Revolut EUR account plus a Revolut HUF account, same entity. Before the
  // fix, entityAccounts.reduce summed the HUF face value straight into the
  // EUR total instead of leaving the entity's position unknown.
  const revolutAccounts: Account[] = [
    {
      key: "R1",
      iban: "LT123456789012345678",
      name: "Current",
      bank: "Revolut",
      entity: "Prive",
      currency: "EUR",
      balance: 4_500,
    },
    {
      key: "R2",
      iban: "LT987654321098765432",
      name: "Current (HUF)",
      bank: "Revolut",
      entity: "Prive",
      currency: "HUF",
      balance: 380_000,
    },
  ];
  const html = renderToStaticMarkup(
    <PositieBlock accounts={revolutAccounts} onNavigate={() => {}} asOf={ASOF} {...SEPARATE} />,
  );
  expect(html).toContain("onbekend");
  expect(html).not.toContain(formatEuro(384_500));
  expect(html).not.toContain(formatEuro(4_500));
  // The footer names WHY the position is unknown, and a real balance in a
  // foreign currency is a different fact than a missing one — it must not be
  // reported under the "zonder compleet saldo" wording that means "no balance
  // at all".
  expect(html).toContain("vreemde valuta");
  expect(html).not.toContain("zonder compleet saldo");
});

test("PositieBlock reports a missing balance, not a currency one, when an entity has both", () => {
  // Missing-balance takes precedence over foreign-currency when one entity has
  // both — the precedent SaldoBlock already sets (excludedCurrencyKeys only
  // counts accounts that DO have a balance). A genuinely missing number is the
  // more fundamental unknown; the entity's footer count must land there.
  const mixed: Account[] = [
    {
      key: "M1",
      iban: "NL01MIXED0000000001",
      name: "Onbekend saldo",
      bank: "ABN",
      entity: "Mixed BV",
      currency: "EUR",
      balance: null,
    },
    {
      key: "M2",
      iban: "LT987654321098765432",
      name: "Current (HUF)",
      bank: "Revolut",
      entity: "Mixed BV",
      currency: "HUF",
      balance: 380_000,
    },
  ];
  const html = renderToStaticMarkup(
    <PositieBlock accounts={mixed} onNavigate={() => {}} asOf={ASOF} {...SEPARATE} />,
  );
  expect(html).toContain("onbekend");
  expect(html).toContain("1 bedrijf zonder compleet saldo");
  expect(html).not.toContain("vreemde valuta");
});

test("PositieBlock renders an empty state when no account has an entity", () => {
  const html = renderToStaticMarkup(
    <PositieBlock accounts={[]} onNavigate={() => {}} asOf={ASOF} {...SEPARATE} />,
  );
  expect(html).toContain("Nog geen rekeningen met een entiteit");
  expect(html).not.toContain("entity-row");
});

/* ───────────────────────── FX-omrekening: convert versus separate */

const revolutHuf: Account[] = [
  {
    key: "R1",
    iban: "LT123456789012345678",
    name: "Current",
    bank: "Revolut",
    entity: "Prive",
    currency: "EUR",
    balance: 4_500,
  },
  {
    key: "R2",
    iban: "LT987654321098765432",
    name: "Current (HUF)",
    bank: "Revolut",
    entity: "Prive",
    currency: "HUF",
    balance: 300_000,
  },
];
const HUF_RATE = { HUF: { [ASOF]: 400 } };

test("PositieBlock: convert mode folds a converted HUF balance into the entity's total, and drops the 'vreemde valuta' line", () => {
  const html = renderToStaticMarkup(
    <PositieBlock
      accounts={revolutHuf}
      onNavigate={() => {}}
      asOf={ASOF}
      fxHistory={HUF_RATE}
      mode="convert"
    />,
  );
  // 300.000 HUF at 400 HUF/EUR is € 750, so Prive's total is 4.500 + 750.
  expect(html).toContain(formatEuro(5_250));
  expect(html).not.toContain("vreemde valuta");
  expect(html).not.toContain("onbekend");
  expect(html).toContain("Omgerekend via ECB.");
});

test("PositieBlock: convert mode with no rate for the balance's date sums what it can price and names the account it can't", () => {
  // Before the fix this nulled the whole entity ("onbekend"), throwing away a
  // real, known € 4.500 because one sibling account had no HUF rate for this
  // date. The fix sums what LaVega CAN price and names what it can't.
  const html = renderToStaticMarkup(
    <PositieBlock
      accounts={revolutHuf}
      onNavigate={() => {}}
      asOf="2025-01-01"
      fxHistory={HUF_RATE}
      mode="convert"
    />,
  );
  expect(html).toContain(formatEuro(4_500));
  expect(html).not.toContain("onbekend");
  expect(html).toContain("vreemde valuta");
  expect(html).toContain("Revolut");
  expect(html).toContain("nog geen koers.");
  expect(html).not.toContain("LaVega rekent nog niet om naar euro");
});

test("PositieBlock: separate mode reproduces the exact prior whole-entity-unknown behaviour even when a rate is available", () => {
  // Separate mode never converts anything, so a mixed EUR+foreign entity
  // stays entirely unknown here — unlike convert mode above, this is not a
  // temporary gap the next import can close, so a partial EUR sum would
  // quietly hide the HUF balance behind a euro figure this mode promises not
  // to produce.
  const html = renderToStaticMarkup(
    <PositieBlock
      accounts={revolutHuf}
      onNavigate={() => {}}
      asOf={ASOF}
      fxHistory={HUF_RATE}
      mode="separate"
    />,
  );
  expect(html).toContain("onbekend");
  expect(html).not.toContain(formatEuro(4_500));
  expect(html).toContain("vreemde valuta");
  expect(html).toContain("Revolut");
  expect(html).toContain("LaVega rekent nog niet om naar euro");
  expect(html).not.toContain("nog geen koers");
  expect(html).not.toContain("Omgerekend via ECB.");
});

/* ───────────────────────── Partial pricing: one unpriced account no longer
 * nulls a whole entity's known money (convert mode only — see separate-mode
 * baseline above). */

const mixedThreeCurrency: Account[] = [
  {
    key: "T1",
    iban: "NL04MIXED0000000001",
    name: "Zakelijk",
    bank: "ABN",
    entity: "Trading BV",
    currency: "EUR",
    balance: 5_000,
  },
  {
    key: "T2",
    iban: "US04MIXED0000000002",
    name: "Current (USD)",
    bank: "Wise USD",
    entity: "Trading BV",
    currency: "USD",
    balance: 1_000,
  },
  {
    key: "T3",
    iban: "GB04MIXED0000000003",
    name: "Current (GBP)",
    bank: "Revolut GBP",
    entity: "Trading BV",
    currency: "GBP",
    balance: 200,
  },
];
// USD has a rate for ASOF; GBP has none at all — the exact repro from the bug
// report (EUR 5.000 + USD 1.000 with a known rate + GBP 200 with no rate).
const MIXED_RATES = { USD: { [ASOF]: 1.25 } };

test("PositieBlock: convert mode sums every priceable account in an entity and names the one it can't price, instead of nulling the whole entity", () => {
  const html = renderToStaticMarkup(
    <PositieBlock
      accounts={mixedThreeCurrency}
      onNavigate={() => {}}
      asOf={ASOF}
      fxHistory={MIXED_RATES}
      mode="convert"
    />,
  );
  // € 5.000 + (1.000 USD / 1.25) = € 5.800 — the GBP 200 stays out, named.
  expect(html).toContain(formatEuro(5_800));
  expect(html).not.toContain("onbekend");
  expect(html).toContain("GBP");
  expect(html).toContain("nog geen koers.");
});

test("PositieBlock: convert mode with zero priceable accounts in an entity still shows unknown, not a false zero", () => {
  const gbpOnly: Account[] = [
    {
      key: "G1",
      iban: "GB04ONLY0000000001",
      name: "Current (GBP)",
      bank: "Revolut GBP",
      entity: "GBP Only BV",
      currency: "GBP",
      balance: 200,
    },
  ];
  const html = renderToStaticMarkup(
    <PositieBlock
      accounts={gbpOnly}
      onNavigate={() => {}}
      asOf={ASOF}
      fxHistory={{}}
      mode="convert"
    />,
  );
  expect(html).toContain("onbekend");
  expect(html).not.toContain(formatEuro(0));
});
