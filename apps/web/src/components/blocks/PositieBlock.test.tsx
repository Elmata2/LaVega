import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { formatEuro } from "../../format.js";
import PositieBlock from "./PositieBlock";
import { accounts } from "./fixtures";

test("PositieBlock renders one compact row per entity in a small card", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={accounts} onNavigate={() => {}} />);
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
  const html = renderToStaticMarkup(<PositieBlock accounts={accounts} onNavigate={() => {}} />);
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
    <PositieBlock accounts={revolutAccounts} onNavigate={() => {}} />,
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
  const html = renderToStaticMarkup(<PositieBlock accounts={mixed} onNavigate={() => {}} />);
  expect(html).toContain("onbekend");
  expect(html).toContain("1 bedrijf zonder compleet saldo");
  expect(html).not.toContain("vreemde valuta");
});

test("PositieBlock renders an empty state when no account has an entity", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={[]} onNavigate={() => {}} />);
  expect(html).toContain("Nog geen rekeningen met een entiteit");
  expect(html).not.toContain("entity-row");
});
