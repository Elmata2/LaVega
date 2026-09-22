import { useMemo, useState } from "react";
import type {
  Account,
  CrossScopeAnswer,
  CrossScopeCrossing,
  CrossScopeKind,
  CrossScopeLeg,
  CrossScopeStream,
  EntityProfile,
  EntityScope,
  OwnName,
  PrivatelyPaidCostRow,
  Tx,
} from "@lavega/core";
import {
  CROSS_SCOPE_PAIR_WINDOW_DAYS,
  businessCostsPaidPrivately,
  crossScopeTransfers,
} from "@lavega/core";
import { formatEuroIn } from "../format.js";
import { useAppLocale } from "../appLocale.js";
import { optimiseCopy } from "../copy/optimise.js";
import type { GrensCopy } from "../copy/optimise.js";
import Module from "../components/Module";
import ToonMeer from "../components/ToonMeer";
import Button from "../components/ui/Button.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";

/* ── PRIVÉ EN ZAKELIJK — de grens op het scherm ─────────────────────────────
 *
 * De meting staat in packages/core/src/crossScope.ts en dit bestand voegt er
 * geen enkel getal aan toe. Wat hier gebeurt is het andere half van het
 * ontwerp: van een meting een ZIN maken die de drie toetsen van sectie 7 van
 * docs/superpowers/specs/2026-08-20-belastingoptimalisatie-design.md doorstaat.
 *
 *  · HERKOMST — elk bedrag noemt waar het vandaan komt. Bij een gekoppelde
 *    overboeking zijn dat twee transacties, en die staan er allebei bij: het
 *    bedrag, de rekening en de datum van beide benen. Bij een rij met één been
 *    staat erbij WAAROM die rij op de lijst staat, want zonder die reden is een
 *    los bedrag geen meting maar een vermoeden.
 *  · METEN OF ZWIJGEN — geen voorwaardelijke euro's. Nergens staat wat een
 *    bedrag geweest zou zijn of geworden zou zijn; er staat wat er bewoog.
 *  · WIE BESLIST — elke onbeantwoorde stroom eindigt in een VRAAG, en het
 *    antwoord komt uit het keuzemenu eronder. LaVega vult er zelf nooit een in.
 *
 * DE TWEE SIGNALEN DIE HIER BEWUST NIET STAAN staan uitgeschreven bovenaan
 * crossScope.ts: geen gebruikelijkloonmeter (hij heeft geen loonadministratie —
 * zijn antwoord van 20 augustus) en geen box-2-kalender (het ontwerp noemt die
 * zelf "the closest thing to advice in the entire proposal"). Beide ontbreken
 * door een besluit, niet door vergeetachtigheid. En de boekhoudkundige naam
 * voor de derde lezing van een kruising is geen waarde in de code en komt niet
 * op dit scherm: dat is een conclusie over een rechtsverhouding, geen meting.
 *
 * WAT LaVega WEL EN NIET BEREKENT staat niet hier maar in `pack.caveats`
 * (packages/core/src/taxpacks/nl.ts), zodat het in de bestaande module "Niet
 * berekend" terechtkomt zonder een tweede mechanisme.
 *
 * DE COPY STAAT IN `copy/optimise.ts` (type `GrensCopy`, één implementatie per
 * taal), als losse functies die alleen strings maken. Dat is geen stijlkeuze
 * maar de reden dat een woordtest volledig kan zijn: een zin die alleen in een
 * tak staat die geen fixture bereikt, wordt door gerenderde HTML nooit gelezen.
 * Elke zin die dit scherm kan tonen komt uit dat object. Wie hier een zin
 * RECHTSTREEKS in de JSX schrijft, omzeilt daarmee de test. */

/** Hoe een kant van de grens heet als er geen ondernemingsnaam bij hoort. Dat
 *  gebeurt bij precies één bewijssoort: als zijn eigen NAAM op de rij staat,
 *  weet LaVega wel dat het naar hem ging maar niet naar welke van zijn
 *  privérekeningen. Dan is "Privé" het eerlijke antwoord en niet een gegokte
 *  naam. Het label komt uit `GrensCopy.sideFallback` en dus in de taal van de
 *  lezer; het stond in core en was daarmee altijd Nederlands. Het register van
 *  dít scherm ("Privé") is nadrukkelijk niet dat van de chrome
 *  ("Persoonlijk") — die twee mogen binnen één scherm niet door elkaar lopen. */
function sideLabel(entity: string | null, scope: EntityScope, copy: GrensCopy): string {
  return entity ?? copy.sideFallback[scope];
}

/** Hoeveel losse overboekingen per stroom op het scherm komen. Wat er niet bij
 *  staat wordt GETELD en genoemd (zie `crossing.moreRows` in `GrensCopy`): een
 *  lijst die stilletjes afkapt, laat een totaal zien dat niet uit zijn eigen
 *  rijen volgt. Dezelfde regel als in components/blocks/statistics.ts. */
const MAX_ROWS_PER_STREAM = 8;

/* ── DE MODULE ───────────────────────────────────────────────────────────── */

export type GrensAnswerRow = { entity: string; answer: CrossScopeAnswer };

type GrensProps = {
  /** DE VOLLEDIGE lijsten, allebei de helften van de grens. Dit is de ene
   *  meting in de app die met opzet over de persoonlijk/zakelijk-schakelaar
   *  heen kijkt; zie de doc-comment bij `crossScopeTransfers`. Gevoed met de
   *  gefilterde lijsten ziet deze module vanuit Persoonlijk geen zakelijke
   *  rekening en vanuit Zakelijk geen privérekening, en levert ze een nul met
   *  een geloofwaardig scherm erachter. De namen `allAccounts`/`allTxs` staan er
   *  zo bij zodat die vergissing op de aanroepplek zichtbaar is: het type is aan
   *  beide kanten gewoon `Account[]` en vangt hem niet. */
  allAccounts: Account[];
  allTxs: Tx[];
  entityProfiles: EntityProfile[];
  asOf: string;
  /** Zijn eigen naam, als hij die in zijn profiel heeft ingevuld. Ontbreekt hij,
   *  dan levert de bewijssoort `eigen-naam-genoemd` eenvoudigweg niets op —
   *  core matcht nooit op een naam die het niet gekregen heeft. */
  ownNames?: readonly OwnName[];
  /** Alle antwoorden uit de vault, van alle ondernemingsrijen samen. */
  answers: readonly CrossScopeAnswer[];
  busy: boolean;
  /** Bewaren gebeurt via de eigenaar van de instellingen (Belasting), omdat daar
   *  ook de nog niet bewaarde bewerkingen liggen waar een antwoord anders onder
   *  zou verdwijnen. Zie de opmerking bij `bewaarGrensAntwoorden`. */
  onSaveAnswers: (rows: GrensAnswerRow[]) => void;
};

export default function Grens({
  allAccounts,
  allTxs,
  entityProfiles,
  asOf,
  ownNames,
  answers,
  busy,
  onSaveAnswers,
}: GrensProps) {
  const [locale] = useAppLocale();
  const copy = optimiseCopy[locale].grens;

  // idle → review → idle. Geen `consent`-fase: die bestaat bij de
  // AI-categorisatie omdat er data naar een model gaat, en hier gaat er niets
  // weg. Wat blijft is de bevestigstap zelf: niets wordt bewaard zonder klik.
  const [phase, setPhase] = useState<"idle" | "review">("idle");
  const [drafts, setDrafts] = useState<Record<string, CrossScopeKind | "">>({});
  const [note, setNote] = useState<string | null>(null);

  const input = useMemo(
    () => ({
      accounts: allAccounts,
      txs: allTxs,
      profiles: entityProfiles,
      asOf,
      names: ownNames,
      answers,
    }),
    [allAccounts, allTxs, entityProfiles, asOf, ownNames, answers],
  );
  const report = useMemo(() => crossScopeTransfers(input), [input]);
  const costs = useMemo(() => businessCostsPaidPrivately(input), [input]);

  /** Wanneer hij een antwoord gaf. Alleen op STROOM-doelen opgezocht, want dit
   *  scherm schrijft nooit een antwoord op één losse overboeking — daardoor kan
   *  deze opzoeking niet uit de pas lopen met `resolveKind` in core. Niets
   *  gevonden betekent: geen datum tonen, geen datum verzinnen. */
  function answerDate(streamKey: string): string | null {
    let best: CrossScopeAnswer | null = null;
    for (const a of answers) {
      if (a.target !== streamKey) continue;
      if (!best || (a.updatedAt ?? "") >= (best.updatedAt ?? "")) best = a;
    }
    return best?.updatedAt ?? null;
  }

  const paragraphs = (lines: string[], prefix: string) =>
    lines.map((line, i) => (
      <p className="cell-sub" key={`${prefix}-${i}`}>
        {line}
      </p>
    ));

  const footer = <span>{copy.footer[0]}</span>;

  // ── De drie toestanden waarin er niets te meten viel ──────────────────────
  if (report.state !== "gemeten") {
    const lines =
      report.state === "geen-zakelijke-entiteit"
        ? copy.emptyStates.geenZakelijkeEntiteit({
            unclassified: report.entities.unclassified,
            personal: report.entities.personal,
          })
        : report.state === "geen-persoonlijke-entiteit"
          ? copy.emptyStates.geenPersoonlijkeEntiteit({ business: report.entities.business })
          : copy.emptyStates.geenTransacties({
              business: report.entities.business,
              personal: report.entities.personal,
              from: report.window.from,
              to: report.window.to,
            });
    return (
      <Module title={copy.header.title} span={2} footer={footer}>
        <div data-testid={`grens-${report.state}`}>{paragraphs(lines, "leeg")}</div>
        {report.state === "geen-transacties" &&
          paragraphs(
            copy.excluded({ ...report.unseen, currencyMismatch: 0, mirrorSuppressed: 0 }),
            "uitgesloten",
          )}
      </Module>
    );
  }

  const { crossings, streams, observed, window: win, unseen } = report;

  // Stromen gegroepeerd op de ZAKELIJKE onderneming. Bij elke kruising is
  // precies één kant zakelijk (core matcht alleen tegengestelde kanten), dus
  // die keuze is eenduidig — en het is dezelfde onderneming waarop het antwoord
  // straks wordt bewaard.
  const businessOf = (s: {
    fromEntity: string | null;
    toEntity: string | null;
    fromScope: EntityScope;
  }): string => (s.fromScope === "business" ? s.fromEntity : s.toEntity) ?? "";

  // GEEN useMemo hieronder, en dat is met opzet: dit staat NA de vroege return
  // van de drie lege toestanden, en een hook achter een return is een hook die
  // niet elke render draait. De dure stap (`crossScopeTransfers`) is al
  // gememoiseerd; wat hier gebeurt is groeperen en sorteren over een lijst die
  // net uit die meting komt.
  const groups: [string, CrossScopeStream[]][] = (() => {
    const m = new Map<string, CrossScopeStream[]>();
    for (const s of streams) {
      const key = businessOf(s);
      const list = m.get(key);
      if (list) list.push(s);
      else m.set(key, [s]);
    }
    return [...m.entries()];
  })();

  const crossingsByStream = (() => {
    const m = new Map<string, CrossScopeCrossing[]>();
    for (const c of crossings) {
      const list = m.get(c.streamKey);
      if (list) list.push(c);
      else m.set(c.streamKey, [c]);
    }
    // Grootste eerst: dat is de volgorde waarin een DGA zijn jaar leest, en de
    // reden dat deze module bestaat (de grootste bewegingen waren onzichtbaar).
    for (const list of m.values()) list.sort((a, b) => b.amountCents - a.amountCents);
    return m;
  })();

  const unanswered = streams.filter((s) => s.kindSource === null);

  function saveAnswers() {
    const rows: GrensAnswerRow[] = [];
    for (const s of unanswered) {
      const kind = drafts[s.key];
      if (!kind) continue; // "" = nog niet beantwoord, en dat is geen antwoord
      const entity = businessOf(s);
      if (!entity) continue; // zonder onderneming is er geen rij om het op te bewaren
      rows.push({ entity, answer: { target: s.key, kind, source: "user", updatedAt: asOf } });
    }
    onSaveAnswers(rows);
    setDrafts({});
    setPhase("idle");
    setNote(copy.answerForm.savedNote({ saved: rows.length })[0]);
  }

  const costRows: readonly PrivatelyPaidCostRow[] = costs.state === "gemeten" ? costs.rows : [];

  return (
    <Module title={copy.header.title} height="tall" span={2} footer={footer}>
      {crossings.length === 0 ? (
        <div data-testid="grens-niets-gekruist">
          {paragraphs(
            copy.emptyStates.nietsGekruist({
              from: win.from,
              to: win.to,
              obsFrom: observed.from,
              obsTo: observed.to,
            }),
            "niets",
          )}
        </div>
      ) : (
        <>
          {/* De herkomstregel hoort bij het VENSTER en niet bij een stroom, dus
              staat hij één keer bovenaan. Per stroom herhalen maakte hem ruis,
              en ruis is precies hoe een herkomstregel ophoudt gelezen te worden. */}
          {paragraphs(
            copy.provenance({
              from: win.from,
              to: win.to,
              obsFrom: observed.from,
              obsTo: observed.to,
              pairWindowDays: CROSS_SCOPE_PAIR_WINDOW_DAYS,
            }),
            "herkomst",
          )}
          {groups.map(([entity, entityStreams]) => (
            <div
              className="border-t border-t-line pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0"
              key={entity || "zonder-naam"}
            >
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className="font-semibold text-ink">{entity}</span>
              </div>
              {entityStreams.map((s) => {
                const rows = crossingsByStream.get(s.key) ?? [];
                const shown = rows.slice(0, MAX_ROWS_PER_STREAM);
                const fromLabel = sideLabel(s.fromEntity, s.fromScope, copy);
                const toLabel = sideLabel(s.toEntity, s.toScope, copy);
                return (
                  <div className="mt-3 first:mt-0" key={s.key}>
                    {paragraphs(
                      copy.stream.heading({
                        fromLabel,
                        toLabel,
                        count: s.count,
                        totalCents: s.totalCents,
                        matchedCents: s.matchedCents,
                        unmatchedCents: s.unmatchedCents,
                        knownCents: s.totalCents - s.unknownCents,
                        unknownCents: s.unknownCents,
                      }),
                      `kop-${s.key}`,
                    )}
                    {s.kindSource !== null &&
                      paragraphs(
                        copy.stream.answer({
                          kind: s.kind,
                          source: s.kindSource,
                          at: answerDate(s.key),
                          count: s.count,
                          firstDate: s.firstDate,
                          lastDate: s.lastDate,
                        }),
                        `antwoord-${s.key}`,
                      )}
                    {s.unknownCount > 0 &&
                      paragraphs(
                        copy.stream.question({
                          fromLabel,
                          toLabel,
                          unknownCents: s.unknownCents,
                          unknownCount: s.unknownCount,
                          // De datum van de laatste ONBEANTWOORDE overboeking, niet
                          // die van de stroom: die twee lopen uiteen zodra één rij
                          // wel een antwoord heeft, en dan zou de zin naar een rij
                          // wijzen waar de vraag niet over gaat.
                          lastDate: rows.reduce(
                            (d, c) => (c.kind === "onbekend" && c.date > d ? c.date : d),
                            s.firstDate,
                          ),
                        }),
                        `vraag-${s.key}`,
                      )}
                    {/* KOP + ANTWOORD/VRAAG hierboven zijn het antwoord; de losse
                      rijen met hun bewijs (welk been gemeten is, en waarom) zijn
                      de onderbouwing. Zelfde indeling als de btw-module in
                      Belasting.tsx — zie ToonMeer.tsx voor waarom dit een
                      <details> is en geen useState. */}
                    <ToonMeer summary={copy.answerForm.toonMeerSummary}>
                      <div className="mt-2 pl-3 border-l-2 border-l-line">
                        {shown.map((c) => (
                          <div className="[&+&]:mt-1" key={c.id}>
                            {paragraphs(crossingLines(c, copy), `rij-${c.id}`)}
                          </div>
                        ))}
                      </div>
                      {rows.length > shown.length &&
                        paragraphs(
                          copy.crossing.moreRows({
                            hidden: rows.length - shown.length,
                            shown: shown.length,
                            count: rows.length,
                          }),
                          `meer-${s.key}`,
                        )}
                    </ToonMeer>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {/* DE DEKKING, onder ELKE gemeten uitkomst — met kruisingen én zonder.
          Zonder deze alinea draagt de nul hierboven een claim die de meting niet
          kan waarmaken ("er kruiste niets") in plaats van de claim die ze wél
          kan waarmaken ("LaVega herkende niets"). Core telt daarvoor
          `unknownCounterAccount` en geeft `ownNameKnown` mee; die twee zijn de
          enige twee manieren waarop deze meting stil blind kan zijn. */}
      {paragraphs(
        copy.coverage({
          unknownCounterAccount: report.unknownCounterAccount,
          ownNameKnown: report.ownNameKnown,
        }),
        "dekking",
      )}

      {report.entities.business.length > 1 &&
        paragraphs(copy.betweenBusiness({ business: report.entities.business }), "tussen")}

      {paragraphs(
        copy.excluded({
          noAccount: unseen.noAccount,
          noEntity: unseen.noEntity,
          currencyMismatch: report.currencyMismatch,
          mirrorSuppressed: report.mirrorSuppressed,
        }),
        "uitgesloten",
      )}

      {/* ── De vragenlijst. Bevestigen-eerst: het keuzemenu bewerkt alleen een
           lokaal concept, en pas "Bewaar antwoorden" schrijft iets weg. ─────── */}
      {unanswered.length > 0 && phase === "idle" && (
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            disabled={busy}
            onClick={() => {
              setNote(null);
              setPhase("review");
            }}
          >
            {copy.answerForm.reviewButtonLabel(unanswered.length)}
          </Button>
        </div>
      )}

      {phase === "review" &&
        (() => {
          const {
            stream: kolomStroom,
            measured: kolomGemeten,
            whatWasThis: kolomWatWasDit,
            notYetAnswered: nogNietBeantwoord,
            salaris: salarisLabel,
            dividend: dividendLabel,
            dontKnow: onbekendLabel,
            save: bewaarLabel,
            cancel: annuleerLabel,
          } = copy.answerForm.table;
          return (
            <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
              {paragraphs(copy.answerForm.explanation({ streams: unanswered.length }), "uitleg")}
              <TableWrap>
                <Table cards>
                  <thead>
                    <tr>
                      <Th>{kolomStroom}</Th>
                      <Th>{kolomGemeten}</Th>
                      <Th>{kolomWatWasDit}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {unanswered.map((s) => {
                      const label = `${sideLabel(s.fromEntity, s.fromScope, copy)} → ${sideLabel(s.toEntity, s.toScope, copy)}`;
                      return (
                        <tr key={s.key}>
                          <Td data-label={kolomStroom}>{label}</Td>
                          <Td data-label={kolomGemeten}>
                            {formatEuroIn(locale, s.totalCents / 100)} · {s.count}× · {s.firstDate}{" "}
                            {copy.answerForm.dateRangeSeparator} {s.lastDate}
                          </Td>
                          <Td data-label={kolomWatWasDit}>
                            <select
                              value={drafts[s.key] ?? ""}
                              disabled={busy}
                              aria-label={copy.answerForm.ariaWhatWas(label)}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [s.key]: e.target.value as CrossScopeKind | "",
                                }))
                              }
                            >
                              <option value="">{nogNietBeantwoord}</option>
                              <option value="salaris">{salarisLabel}</option>
                              <option value="dividend">{dividendLabel}</option>
                              <option value="onbekend">{onbekendLabel}</option>
                            </select>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
              <Button variant="primary" disabled={busy} onClick={saveAnswers}>
                {bewaarLabel}
              </Button>{" "}
              <Button
                disabled={busy}
                onClick={() => {
                  setDrafts({});
                  setPhase("idle");
                }}
              >
                {annuleerLabel}
              </Button>
            </div>
          );
        })()}
      {note && (
        <p className="cell-sub" role="alert">
          {note}
        </p>
      )}

      {/* ── Het bijproduct ────────────────────────────────────────────────── */}
      <div
        className="border-t border-t-line pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0"
        data-testid="grens-bijproduct"
      >
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="font-semibold text-ink">{copy.byproduct.heading}</span>
        </div>
        {paragraphs(copy.byproduct.summary({ rows: costRows.length }), "bijproduct-kop")}
        {costRows.map((r) => (
          <div key={r.merchant}>
            {paragraphs(copy.byproduct.row(r), `bijproduct-${r.merchant}`)}
          </div>
        ))}
      </div>
    </Module>
  );
}

/** De zin(nen) van één overboeking. Buiten de component gehouden zodat de
 *  woordtest hem los kan aanroepen zonder een render. Krijgt de al-opgezochte
 *  locale-copy mee in plaats van zelf `useAppLocale` aan te roepen: dit is
 *  geen component en mag geen hook aanroepen. */
function crossingLines(c: CrossScopeCrossing, copy: GrensCopy): string[] {
  const fromLabel = sideLabel(c.fromEntity, c.fromScope, copy);
  const toLabel = sideLabel(c.toEntity, c.toScope, copy);
  if (c.matched && c.legs.length === 2) {
    const uit: CrossScopeLeg = c.legs[0].signedCents < 0 ? c.legs[0] : c.legs[1];
    const bij: CrossScopeLeg = uit === c.legs[0] ? c.legs[1] : c.legs[0];
    return copy.crossing.twoLegs({
      amountCents: c.amountCents,
      date: c.date,
      fromLabel,
      toLabel,
      uitLabel: uit.entity,
      uitDate: uit.date,
      uitCents: uit.signedCents,
      inLabel: bij.entity,
      inDate: bij.date,
      inCents: bij.signedCents,
    });
  }
  return copy.crossing.oneLeg({
    amountCents: c.amountCents,
    date: c.date,
    fromLabel,
    toLabel,
    evidence: c.evidence,
    uitgaand: (c.legs[0]?.signedCents ?? 0) < 0,
  });
}
