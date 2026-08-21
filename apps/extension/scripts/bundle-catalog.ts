/* Van docs/catalog/catalog.json naar src/generated/catalog.generated.ts.
 *
 * WAAROM EEN KOPIE EN GEEN IMPORT. De extensie is een losse bundel die Chrome
 * uit een map laadt; er is geen server en geen tab om iets aan te vragen. Alles
 * wat ze weet moet dus in de bundel zitten. Dit is exact het patroon van
 * scripts/bundle-bank-logos.ts: opgehaald tijdens een sweep, hier neergelegd,
 * in de browser wordt er niets opgehaald.
 *
 * WAAROM EEN SUBSET EN NIET HET HELE BESTAND. catalog.json is 122 producten
 * inclusief spaarrekeningen en beleggingsrekeningen. Aan een kassa betaal je
 * niet met een spaarrekening, dus die rijen zouden alleen de bundel groter maken
 * en het lijstje "mijn kaarten" onleesbaar. Gefilterd op producten waarmee je
 * kunt AFREKENEN (creditcard, betaalpas, prepaid, crypto-kaart) die minstens
 * één cijfer hebben dat aan de kassa iets betekent.
 *
 * WAT ER MEEGAAT PER CIJFER: value, sourceUrl, checkedAt en de volledige
 * conditions-tekst. Die tekst is lang en het is verleidelijk hem af te kappen,
 * maar bij crypto.com staat de hele voorwaarde ("alleen met gestakete CRO") IN
 * die tekst — een afgekapte voorwaarde is een andere voorwaarde. Dus voluit of
 * niet, en het is voluit.
 *
 * WAT ER NIET MEEGAAT: interestPct. Rente is een jaarlijkse opbrengst op een
 * saldo en heeft niets te maken met de vraag welke kaart je nu aantikt. Die
 * hoort in de Optimalisatie-tab en niet hier.
 *
 * Draaien: pnpm --filter @lavega/extension bundle:catalog
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = resolve(HERE, "../../../docs/catalog/catalog.json");
const OUT = resolve(HERE, "../src/generated/catalog.generated.ts");

/** Alleen producten waarmee je aan een kassa kunt betalen. Een spaarrekening
 *  heeft geen pinpas, dus die hoort niet in het lijstje "welke kaarten heb ik". */
const PAYABLE_KINDS = new Set(["creditcard", "betaalpas", "prepaid", "crypto"]);

/** De cijfers die een afrekening raken. `accountFee` staat er apart bij omdat
 *  hij niet iets over de aankoop zegt maar over het HOUDEN van de kaart — en dat
 *  onderscheid is de hele horizonregel (zie src/horizon.ts). */
const SPEND_FIELDS = ["fxFeePct", "cashbackPct", "pointsPerEuro"] as const;

type RawValue = {
  value: number;
  sourceUrl?: string;
  checkedAt?: string;
  conditions?: string;
  period?: string;
};
type RawEntry = {
  id: string;
  product: string;
  issuer: string;
  kind: string;
  fields: Record<string, RawValue | undefined>;
};

const raw = JSON.parse(readFileSync(CATALOG, "utf8")) as {
  generatedAt: string;
  entries: RawEntry[];
};

function sourced(v: RawValue | undefined): string | null {
  if (!v || typeof v.value !== "number") return null;
  return JSON.stringify({
    value: v.value,
    sourceUrl: v.sourceUrl ?? "",
    checkedAt: v.checkedAt ?? "",
    conditions: v.conditions ?? null,
  });
}

/** accountFee draagt een PERIODE naast het bedrag, en dat is geen detail: een
 *  jaarprijs en een maandprijs door elkaar halen is een factor twaalf. Een fee
 *  zonder leesbare periode gaat daarom NIET mee — dan is de periode onbekend, en
 *  onbekend is geen maand. */
function fee(v: RawValue | undefined): string | null {
  if (!v || typeof v.value !== "number") return null;
  const period = v.period === "maand" || v.period === "jaar" ? v.period : null;
  if (!period) return null;
  return JSON.stringify({
    value: v.value,
    period,
    sourceUrl: v.sourceUrl ?? "",
    checkedAt: v.checkedAt ?? "",
    conditions: v.conditions ?? null,
  });
}

const rows: string[] = [];
let counts = { total: 0, fx: 0, cashback: 0, points: 0, fee: 0, feeDropped: 0 };

for (const e of raw.entries) {
  if (!PAYABLE_KINDS.has(e.kind)) continue;
  if (!SPEND_FIELDS.some((f) => e.fields[f])) continue;

  const fx = sourced(e.fields.fxFeePct);
  const cb = sourced(e.fields.cashbackPct);
  const pt = sourced(e.fields.pointsPerEuro);
  const fe = fee(e.fields.accountFee);
  if (e.fields.accountFee && !fe) counts.feeDropped++;

  counts.total++;
  if (fx) counts.fx++;
  if (cb) counts.cashback++;
  if (pt) counts.points++;
  if (fe) counts.fee++;

  rows.push(
    `  {\n` +
      `    id: ${JSON.stringify(e.id)},\n` +
      `    product: ${JSON.stringify(e.product)},\n` +
      `    issuer: ${JSON.stringify(e.issuer)},\n` +
      `    kind: ${JSON.stringify(e.kind)},\n` +
      `    fxFeePct: ${fx ?? "null"},\n` +
      `    cashbackPct: ${cb ?? "null"},\n` +
      `    pointsPerEuro: ${pt ?? "null"},\n` +
      `    fee: ${fe ?? "null"},\n` +
      `  },`,
  );
}

const header = `/* GEGENEREERD — niet met de hand bijwerken.
 *
 * Bron: docs/catalog/catalog.json (generatedAt ${raw.generatedAt}).
 * Gemaakt door apps/extension/scripts/bundle-catalog.ts.
 *
 * ${counts.total} producten waarmee je kunt afrekenen. Daarvan:
 *   ${counts.fx} met een koersopslag-cijfer,
 *   ${counts.cashback} met een cashback-cijfer,
 *   ${counts.points} met een puntencijfer,
 *   ${counts.fee} met kaartkosten INCLUSIEF periode (maand of jaar).
 * ${counts.feeDropped} fee-cijfer(s) zijn overgeslagen omdat er geen leesbare
 * periode bij stond; een bedrag zonder periode is niet te verrekenen.
 *
 * Dat ${counts.total - counts.fee} van de ${counts.total} producten GEEN
 * kaartkosten in de catalogus hebben, is geen fout in dit bestand en ook geen
 * nul: het is de reden dat rank.ts een aparte, brutouitkomst kent waar het
 * woord "netto" niet valt.
 */

import type { CheckoutCard } from "../types.js";

export const CATALOG_GENERATED_AT = ${JSON.stringify(raw.generatedAt)};

export const CHECKOUT_CARDS: readonly CheckoutCard[] = [
`;

writeFileSync(OUT, header + rows.join("\n") + "\n];\n", "utf8");
console.log(`[bundle-catalog] ${OUT}`);
console.log(`[bundle-catalog]`, counts);
