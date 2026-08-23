import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { formatEuro } from "../../format.js";
import {
  BetaalschemaBlock,
  agendaRows,
  cadenceLabel,
  nextOccurrence,
} from "./BetaalschemaBlock";
import { ASOF, scheduledFlows } from "./fixtures";

/** A monthly subscription core's detector will recognise: same counterparty,
 *  same amount, ~30 days apart, three occurrences. */
const recurring: Tx[] = ["2026-05-18", "2026-06-17", "2026-07-17"].map((date, i) => ({
  id: `sub${i}`,
  accountKey: "A1",
  date,
  amount: -14.99,
  currency: "EUR",
  counterparty: "Spotify",
  description: "Premium",
  category: "",
  manual: false,
}));

test("BetaalschemaBlock lists the planned flows by due date, overdue flagged", () => {
  const html = renderToStaticMarkup(
    <BetaalschemaBlock scheduledFlows={scheduledFlows} txs={[]} asOf={ASOF} />,
  );
  expect(html).toContain("Betaalagenda");
  // Sorted ascending by date: 31 jul (overdue) before 28 aug before 31 okt.
  expect(html.indexOf("BTW Q2 2026")).toBeLessThan(html.indexOf("Factuur Klant BV"));
  expect(html.indexOf("Factuur Klant BV")).toBeLessThan(html.indexOf("BTW Q3 2026"));
  expect(html).toContain(">31<");
  expect(html).toContain(">jul<");
  expect(html).toContain("pay-date-overdue");
  expect(html).toContain("te laat");
  expect(html).toContain("1 datum al verstreken.");
  // sign drives the amount's direction: -1 out, +1 in.
  expect(html).toContain(formatEuro(-4_125));
  expect(html).toContain(formatEuro(1_200));
  // A paid flow is not part of the agenda any more.
  expect(html).not.toContain("Al betaald");
  expect(html).toContain("Alle regels zijn ingeplande bedragen.");
});

test("BetaalschemaBlock adds detected recurring payments and marks them as predictions", () => {
  const html = renderToStaticMarkup(
    <BetaalschemaBlock scheduledFlows={scheduledFlows} txs={recurring} asOf={ASOF} />,
  );
  expect(html).toContain("Spotify");
  expect(html).toContain("voorspeld");
  expect(html).toContain("maandelijks · 3× gezien");
  expect(html).toContain("1 regel voorspeld uit je eigen geschiedenis, niet bevestigd.");
  expect(html).toContain(formatEuro(-14.99));
});

test("BetaalschemaBlock renders an empty state when nothing is scheduled or detected", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={[]} asOf={ASOF} />);
  expect(html).toContain("Niets ingepland");
  expect(html).not.toContain("pay-row");
});

test("nextOccurrence rolls a stream forward past today, never back", () => {
  // Last seen 17 jul, monthly: the next one after 16 aug is 16 aug itself.
  expect(nextOccurrence("2026-07-17", 30, ASOF)).toBe("2026-08-16");
  // A stream whose last occurrence is already in the future just steps once.
  expect(nextOccurrence("2026-09-01", 30, ASOF)).toBe("2026-10-01");
  // Several cadences behind: it lands on or after asOf, not on the first step.
  expect(nextOccurrence("2026-01-05", 30, ASOF) >= ASOF).toBe(true);
});

test("cadenceLabel names the cadences core snaps to", () => {
  expect(cadenceLabel(7)).toBe("wekelijks");
  expect(cadenceLabel(14)).toBe("elke 2 weken");
  expect(cadenceLabel(30)).toBe("maandelijks");
  expect(cadenceLabel(91)).toBe("elk kwartaal");
  expect(cadenceLabel(365)).toBe("jaarlijks");
});

test("agendaRows keeps a prediction distinguishable from a committed date", () => {
  const rows = agendaRows(scheduledFlows, recurring, ASOF);
  const spotify = rows.find((r) => r.label === "Spotify");
  expect(spotify?.predicted).toBe(true);
  expect(rows.find((r) => r.label === "BTW Q2 2026")?.predicted).toBe(false);
  // Sorted by date, oldest first.
  expect([...rows].map((r) => r.date)).toEqual([...rows].map((r) => r.date).sort());
});

/* App review 2, item 5. Three streams he named were missing from the agenda:
 * his phone (Simyo), the gemeentebelasting, and DUO — "the government giving me
 * money, it's also a monthly one". Measured cause: the agenda ran on the
 * forecast's stream detector, which groups on the verbatim counterparty (a Dutch
 * export renames the same incasso every month) and rejects a stream that skipped
 * a cycle. All three rows below come straight from a real export's shapes. */
const simyo: Tx[] = [
  ["2026-03-04", "SIMYO B.V.", "SEPA Incasso algemeen doorlopend Machtiging: M0012938"],
  ["2026-04-04", "Simyo B.V. 4839201", "SEPA Incasso algemeen doorlopend"],
  ["2026-05-04", "SIMYO", "Incasso 100238471"],
  // juni: de incasso mislukte. Eén overgeslagen maand is geen ander abonnement.
  ["2026-07-04", "SIMYO B.V.", "SEPA Incasso algemeen doorlopend"],
  ["2026-08-04", "Simyo B.V.", "SEPA Incasso algemeen doorlopend"],
].map(([date, counterparty, description], i) => ({
  id: `sim${i}`, accountKey: "A1", date, amount: -11.89, currency: "EUR",
  counterparty, description, category: "", manual: false,
}));

const duo: Tx[] = [
  ["2026-05-25", "DUO"],
  ["2026-06-24", "Dienst Uitvoering Onderwijs"],
  ["2026-07-24", "DUO"],
  ["2026-08-24", "DUO Groningen"],
].map(([date, counterparty], i) => ({
  id: `duo${i}`, accountKey: "A1", date, amount: 512.1, currency: "EUR",
  counterparty, description: "Studiefinanciering", category: "", manual: false,
}));

test("de agenda ziet Simyo, ook met een schuivende tenaamstelling en een gemiste maand", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={simyo} asOf={ASOF} />);
  expect(html).toContain("SIMYO B.V.");
  expect(html).toContain("maandelijks · 5× gezien");
  expect(html).toContain(formatEuro(-11.89));
  expect(html).toContain("voorspeld");
});

test("een inkomende maandstroom (DUO) staat net zo goed in de agenda", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={duo} asOf={ASOF} />);
  expect(html).toContain("DUO");
  expect(html).toContain(formatEuro(512.1));
  expect(html).toContain("text-pos");
});

test("een gestopte stroom wordt niet meer vooruit geschoven", () => {
  // Laatste afschrijving maart, asOf half augustus: dit betaalt niemand meer.
  const gestopt: Tx[] = simyo.slice(0, 3);
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={gestopt} asOf={ASOF} />);
  expect(html).toContain("Niets ingepland");
});

test("cadenceLabel noemt ook de twee cadences die core erbij kreeg", () => {
  expect(cadenceLabel(61)).toBe("tweemaandelijks");
  expect(cadenceLabel(182)).toBe("halfjaarlijks");
});

/* --- Review 4, punt 7: de naam is afgekapt en niet te lezen -------------- *
 *
 * Eerst gemeten, want een naam die op één letter eindigt kan drie dingen
 * betekenen en hij noemde ze alle drie. De uitkomst staat voluit in het blok
 * zelf; kort: geen verkeerde afkapfunctie (de test hieronder vindt de hele naam
 * letterlijk terug), geen verkeerd veld (core geeft de tegenpartij verbatim),
 * wel een smalle kolom — maar die geeft er zo'n 27, geen één.
 *
 * Deze tests dekken daarom wat er WEL reproduceerbaar misgaat, en niet meer dan
 * dat: de naam kapt af zonder dat je de rest te zien krijgt, en de pil viel met
 * hem mee weg. Wat "V…" precies was blijft open. */

const langeNaam = "B Steunenberg en/of mevr. A L Dimitrova";

/** Zijn eigen voorbeeld, als een maandelijkse stroom die de agenda oppikt. */
const huur: Tx[] = ["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"].map((date, i) => ({
  id: `huur${i}`,
  accountKey: "A1",
  date,
  amount: -1250,
  currency: "EUR",
  counterparty: langeNaam,
  description: "Huur",
  category: "",
  manual: false,
}));

test("de volledige naam staat er echt — er wordt niets in code afgekapt", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={huur} asOf={ASOF} />);
  // De hele naam, letterlijk. Geen initialen, geen eerste woord, geen ellips.
  expect(html).toContain(langeNaam);
  expect(html).not.toContain("…");
  // En hij staat ook in het title-attribuut, voor wie met de muis wacht. Dat is
  // de aanvulling, niet de oplossing: op een telefoon bestaat hover niet.
  expect(html).toContain(`title="${langeNaam.replace(/&/g, "&amp;")}"`);

  const rows = agendaRows([], huur, ASOF);
  expect(rows[0]?.label).toBe(langeNaam);
});

test("de rij is een knop, zodat de naam ook met een tik of het toetsenbord opengaat", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={huur} asOf={ASOF} />);
  expect(html).toContain('<button type="button" class="pay-row"');
  expect(html).toContain('data-open="off"');
  expect(html).toContain('aria-expanded="false"');
});

test("de voorspeld-pil valt niet met de naam mee weg", () => {
  /* Gemeten oorzaak: het afkappen zat op `.pay-label`, en de pil stond IN dat
   * vakje. Bij een lange naam viel de pil buiten het zichtbare deel en zag een
   * voorspelde regel eruit als een bevestigde afspraak — een bewering die de
   * afwezigheid van de pil niet kan dragen. De pil staat nu naast de afkappende
   * span, niet erin. */
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={huur} asOf={ASOF} />);
  const naam = html.indexOf('class="pay-name"');
  const pil = html.indexOf('class="pay-tag"');
  expect(naam).toBeGreaterThan(-1);
  expect(pil).toBeGreaterThan(naam);
  // De pil staat NA het sluiten van de naam-span, dus buiten het afkappende vak.
  expect(html.slice(naam, pil)).toContain("</span>");
});

test("blocks.css maakt de naam op alle drie de manieren leesbaar", () => {
  /* Het pad hangt aan dit BESTAND, niet aan de werkmap. `process.cwd()` stond
   * hier eerst en dat klopt alleen zolang vitest vanuit apps/web draait; vanaf
   * de repo-wortel las dezelfde regel een bestand dat er niet is en viel de test
   * om met ENOENT — een fout die niets zegt over de opmaak die hij toetst. */
  const css = readFileSync(fileURLToPath(new URL("../../styles/blocks.css", import.meta.url)), "utf8");
  const flat = css.replace(/\s+/g, " ");
  // Muis, toetsenbord, tik — dezelfde drie als bij de taartlegenda (review 3
  // punt 8), want dat is waar hij toen al om vroeg.
  expect(flat).toContain(".pay-row:hover .pay-name");
  expect(flat).toContain(".pay-row:focus-visible .pay-name");
  expect(flat).toContain('.pay-row[data-open="on"] .pay-name');
  const onthult = flat.match(/\.pay-row:hover \.pay-name,[^{]*\{[^}]*\}/)?.[0] ?? "";
  expect(onthult).toContain("white-space: normal");
  expect(onthult).toContain("overflow: visible");
  // Alleen de naam kapt af, niet het vak waar de pil ook in staat.
  expect(flat).toContain(".pay-name { min-width: 0; overflow: hidden; text-overflow: ellipsis;");
  // Geen animatie op deze rij: een toestand mag, een overgang niet.
  const rij = flat.match(/\.pay-row \{[^}]*\}/)?.[0] ?? "";
  expect(rij).not.toContain("transition");
});
