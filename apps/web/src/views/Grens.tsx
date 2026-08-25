import { useMemo, useState } from "react";
import type {
  Account, CrossScopeAnswer, CrossScopeCrossing, CrossScopeEvidence, CrossScopeKind,
  CrossScopeLeg, CrossScopeStream, EntityProfile, EntityScope, OwnName, PrivatelyPaidCostRow, Tx,
} from "@lavega/core";
import {
  CROSS_SCOPE_PAIR_WINDOW_DAYS,
  ENTITY_SCOPE_LABELS,
  businessCostsPaidPrivately,
  crossScopeTransfers,
} from "@lavega/core";
import { formatEuro } from "../format";
import Module from "../components/Module";

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
 * DE COPY STAAT IN `GRENS_COPY`, als losse functies die alleen strings maken.
 * Dat is geen stijlkeuze maar de reden dat de woordtest in belasting-ui.test.tsx
 * volledig kan zijn: een zin die alleen in een tak staat die geen fixture
 * bereikt, wordt door gerenderde HTML nooit gelezen. Elke zin die dit scherm kan
 * tonen komt uit dit object, en de test loopt het object ook rechtstreeks af.
 * Wie hier een zin RECHTSTREEKS in de JSX schrijft, omzeilt daarmee de test. */

const euro = (cents: number): string => formatEuro(cents / 100);

/** Hoe een kant van de grens heet als er geen ondernemingsnaam bij hoort. Dat
 *  gebeurt bij precies één bewijssoort: als zijn eigen NAAM op de rij staat,
 *  weet LaVega wel dat het naar hem ging maar niet naar welke van zijn
 *  privérekeningen. Dan is "Privé" het eerlijke antwoord en niet een gegokte
 *  naam. Labels komen uit core (`ENTITY_SCOPE_LABELS`, Privé/Zakelijk) en
 *  nadrukkelijk niet uit de chrome (Persoonlijk/Zakelijk) — zie de opmerking
 *  bij `SCOPE_LABELS` in apps/web/src/scope.ts: die twee mogen binnen één scherm
 *  niet door elkaar lopen. */
function sideLabel(entity: string | null, scope: EntityScope): string {
  return entity ?? ENTITY_SCOPE_LABELS[scope];
}

/** Een opsomming zoals je hem uitspreekt: "BV1, BV2 en Privé". */
function listNl(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} en ${items[items.length - 1]}`;
}

const KIND_LABELS: Record<CrossScopeKind, string> = {
  salaris: "salaris",
  dividend: "dividend",
  onbekend: "weet ik niet",
};

/** Wie het antwoord gaf. Alleen hij kan het via dit scherm geven; "agent" kan
 *  wel in de vault staan (core kent de bron) en krijgt daarom een eigen zin in
 *  plaats van stilzwijgend als zijn woorden te worden gepresenteerd. */
const SOURCE_LABELS: Record<"user" | "agent", string> = {
  user: "Jij noemde",
  agent: "Een agent noemde",
};

/** Waarom een rij met maar één been toch op de lijst staat. Zonder deze reden
 *  is het bedrag niet te beoordelen — zie `CrossScopeEvidence` in core, waar
 *  staat waarom een been zonder bewijs er helemaal niet bij komt. */
const EVIDENCE_REASON: Record<CrossScopeEvidence, string> = {
  "twee-benen": "Beide kanten staan in je vault.",
  "eigen-rekening-genoemd":
    "Deze rij staat er toch bij omdat er een andere rekening van jezelf op staat, aan de andere kant van de grens.",
  "eigen-naam-genoemd":
    "Deze rij staat er toch bij omdat er je eigen naam op staat, zoals je die zelf in je profiel hebt ingevuld.",
};

/** Hoeveel losse overboekingen per stroom op het scherm komen. Wat er niet bij
 *  staat wordt GETELD en genoemd (zie `GRENS_COPY.meerRijen`): een lijst die
 *  stilletjes afkapt, laat een totaal zien dat niet uit zijn eigen rijen volgt.
 *  Dezelfde regel als in components/blocks/statistics.ts. */
const MAX_ROWS_PER_STREAM = 8;

/* ── DE ZINNEN ───────────────────────────────────────────────────────────── */

export const GRENS_COPY = {
  /** Niets als zakelijk gemarkeerd. Dit is de belangrijkste zin van de module:
   *  `entities.ts` zet elke onbekende entiteit op privé, dus in een vault waar
   *  hij niets heeft ingedeeld is het aantal kruisingen STRUCTUREEL nul. "€ 0"
   *  zou hier de fout "je saldi staan al op de beste plek" op een nieuwe plek
   *  herhalen. De laatste zin is een OVERDRACHT naar de plek waar het besluit
   *  al woont (Profiel → "Persoonlijk of zakelijk"), geen opdracht. */
  geenZakelijkeEntiteit(a: { unclassified: readonly string[]; personal: readonly string[] }): string[] {
    const out = [
      "Je hebt nog geen onderneming als zakelijk gemarkeerd, dus er is geen grens om te meten. Dat is iets anders dan nul overboekingen: er valt hier nog niets te vergelijken.",
      "Onder Profiel → “Persoonlijk of zakelijk” bepaal je zelf welke onderneming een bedrijf is; wat je niet indeelt, telt als privé.",
    ];
    if (a.unclassified.length > 0) {
      out.push(
        `LaVega ziet nu ${a.unclassified.length} onderneming${a.unclassified.length === 1 ? "" : "en"} waarvan dat nog niet gezegd is: ${listNl(a.unclassified)}.`,
      );
    } else if (a.personal.length > 0) {
      out.push(`LaVega ziet nu alleen ondernemingen die als privé zijn gemarkeerd: ${listNl(a.personal)}.`);
    } else {
      out.push("Er staat nog geen onderneming in je vault; die komen er met je eerste import bij.");
    }
    return out;
  },

  /** De spiegel: alles zakelijk, dus geen overkant. */
  geenPersoonlijkeEntiteit(a: { business: readonly string[] }): string[] {
    return [
      `Elke onderneming in je vault is als zakelijk gemarkeerd (${listNl(a.business)}), dus er is geen privékant om naartoe over te steken.`,
      "Ook dat is geen nul: er is geen overkant om te meten. Welke onderneming wat is, staat onder Profiel → “Persoonlijk of zakelijk”.",
    ];
  },

  /** Ingedeeld, maar geen enkele transactie die LaVega op een onderneming kan
   *  plaatsen. Zie `CrossScopeUnseen` in core voor wat er dan buiten viel. */
  geenTransacties(a: { business: readonly string[]; personal: readonly string[]; from: string; to: string }): string[] {
    return [
      `${listNl(a.business)} ${a.business.length === 1 ? "is" : "zijn"} als zakelijk gemarkeerd en ${listNl(a.personal)} als privé, maar van ${a.from} t/m ${a.to} staat er geen transactie in je vault die LaVega op een van die ondernemingen kan plaatsen.`,
      "Dat is geen nul — er is niets om te meten.",
    ];
  },

  /** Wél gemeten, en er kwam geen kruising uit. Dit is de enige nul die deze
   *  module mag uitspreken, en hij zegt erbij waaruit hij volgt.
   *
   *  TWEE WOORDEN ZIJN HIER MET OPZET VERANDERD, en het scheelt een onwaarheid.
   *  Er stond eerst "staat er geen overboeking IN JE VAULT die de grens
   *  oversteekt" en "er geen GEVONDEN". Dat is een uitspraak over zijn vault,
   *  terwijl LaVega alleen een uitspraak kan doen over wat het herkent: één
   *  afschrijving van € 12.400 naar zijn eigen Rabobankrekening die hij nooit
   *  importeerde, kruist de grens wél en is op de regel van niets te
   *  onderscheiden. Wat LaVega wél en niet herkent staat er nu onder, in
   *  `dekking` — en dát is wat deze nul draagt. */
  nietsGekruist(a: { from: string; to: string; obsFrom: string; obsTo: string }): string[] {
    return [
      `Van ${a.from} t/m ${a.to} vond LaVega geen overboeking die de grens tussen zakelijk en privé oversteekt.`,
      `Dit is wél gemeten: LaVega heeft de transacties van ${a.obsFrom} t/m ${a.obsTo} aan beide kanten van de grens gelezen.`,
    ];
  },

  /** WAT DEZE METING KAN ZIEN, en waar ze blind is. Staat onder ELKE gemeten
   *  uitkomst — ook onder een totaal van nul, en juist daar, want een nul zonder
   *  zijn eigen blinde vlek leest als "er is niets", terwijl er alleen niets
   *  HERKEND is. De teller komt uit core (`unknownCounterAccount`) en telt rijen,
   *  geen euro's: de meeste van die rijen zijn gewone betalingen aan derden, en
   *  er een bedrag naast zetten zou suggereren dat dat geld naar hem ging. Dat
   *  is precies de insinuatie die deze module weigert te doen. */
  dekking(a: { unknownCounterAccount: number; ownNameKnown: boolean }): string[] {
    const out = [
      "LaVega herkent een overboeking naar jezelf aan één van drie dingen: de tegenboeking staat in je vault, er staat een andere rekening van jezelf op de regel, of er staat je eigen naam op. Een afschrijving met geen van die drie telt hier niet mee — dan is er geen bewijs dat het geld naar jou ging in plaats van naar iemand anders.",
    ];
    if (a.unknownCounterAccount > 0) {
      out.push(
        `Op ${a.unknownCounterAccount} afschrijving${a.unknownCounterAccount === 1 ? "" : "en"} van een zakelijke rekening staat een rekeningnummer dat in geen enkele rekening van je vault voorkomt. Van wie die rekening is, ziet LaVega niet, dus ${a.unknownCounterAccount === 1 ? "die rij telt" : "die rijen tellen"} hier niet mee. Een rekening die je zelf importeert, herkent LaVega wél.`,
      );
    }
    if (!a.ownNameKnown) {
      out.push(
        "Je eigen naam staat niet in je profiel. Een afschrijving waar alleen jouw naam op staat en geen rekening uit je vault, herkent LaVega daardoor niet als kruising; onder Profiel staat het veld waar die naam vandaan komt.",
      );
    }
    return out;
  },

  /** De herkomstregel onder elk totaal. Noemt het VENSTER waarover gemeten is,
   *  wat er in dat venster daadwerkelijk aan data stond (dat is iets anders), en
   *  de koppelregel zelf — inclusief het aantal dagen, dat uit core komt en niet
   *  hier hardcoded staat. */
  herkomst(a: { from: string; to: string; obsFrom: string; obsTo: string; pairWindowDays: number }): string[] {
    return [
      `Gemeten in je transacties van ${a.from} t/m ${a.to}; de eerste rij die LaVega daarin zag is van ${a.obsFrom}, de laatste van ${a.obsTo}.`,
      `Een overboeking is aan twee kanten gemeten als beide rekeningen in je vault staan, de bedragen op de cent gelijk zijn en de bijschrijving 0 tot ${a.pairWindowDays} dagen na de afschrijving valt. Wat maar één kant heeft, staat er apart bij, met de reden waarom die rij op de lijst staat.`,
    ];
  },

  /** De kop van één stroom: het totaal, de sterkte van het bewijs en het deel
   *  waarvan niemand gezegd heeft wat het was. Drie zinnen, want het zijn drie
   *  verschillende dingen en ze samentrekken maakt er één claim van die te veel
   *  belooft. Elk deel heeft een eigen tak voor "helemaal" en "helemaal niet",
   *  zodat er nergens "€ 0,00" op het scherm komt. */
  stroomKop(a: {
    fromLabel: string; toLabel: string; count: number;
    totalCents: number; matchedCents: number; unmatchedCents: number;
    knownCents: number; unknownCents: number;
  }): string[] {
    const out = [
      `${euro(a.totalCents)} ging van ${a.fromLabel} naar ${a.toLabel}, in ${a.count} overboeking${a.count === 1 ? "" : "en"}.`,
    ];
    if (a.unmatchedCents === 0) out.push("Van al deze overboekingen staan beide kanten in je vault.");
    else if (a.matchedCents === 0) out.push("Van geen van deze overboekingen staat de tegenboeking in je vault; elke rij is aan één kant gemeten.");
    else out.push(`Van ${euro(a.matchedCents)} staan beide kanten in je vault; van ${euro(a.unmatchedCents)} maar één kant.`);

    if (a.unknownCents === 0) out.push("Je hebt zelf gezegd wat deze overboekingen waren.");
    else if (a.knownCents === 0) out.push("LaVega weet van geen van deze overboekingen wat het was.");
    else out.push(`Van ${euro(a.knownCents)} heb je zelf gezegd wat het was; van ${euro(a.unknownCents)} weet LaVega niet wat het was.`);
    return out;
  },

  /** Zijn eigen antwoord, terug op het scherm met zijn datum EN met hoeveel
   *  overboekingen het dekt. Dat laatste is er met opzet: een antwoord geldt per
   *  STROOM, dus een antwoord uit maart spreekt ook voor december. Door het
   *  bereik erbij te zetten kan hij zien wanneer dat niet meer klopt. */
  stroomAntwoord(a: {
    kind: CrossScopeKind; source: "user" | "agent"; at: string | null;
    count: number; firstDate: string; lastDate: string;
  }): string[] {
    return [
      `${SOURCE_LABELS[a.source]} deze stroom “${KIND_LABELS[a.kind]}”${a.at ? ` op ${a.at}` : ""}. Dat antwoord staat bij alle ${a.count} overboeking${a.count === 1 ? "" : "en"} van deze stroom, van ${a.firstDate} t/m ${a.lastDate}.`,
    ];
  },

  /** De vraag. Dit is de zin die het ontwerp zelf toestaat, letterlijk: een
   *  bedrag, een aantal, een datum en een vraagteken. */
  stroomVraag(a: {
    fromLabel: string; toLabel: string; unknownCents: number; unknownCount: number; lastDate: string;
  }): string[] {
    return [
      `${euro(a.unknownCents)} · ${a.unknownCount} overboeking${a.unknownCount === 1 ? "" : "en"}, de laatste op ${a.lastDate} · ${a.fromLabel} → ${a.toLabel}. LaVega ziet niet wat deze overboekingen waren. Wat was dit?`,
    ];
  },

  /** Eén gekoppelde overboeking: het bedrag noemt allebei de transacties waar
   *  het uit komt. Dat is de herkomst-toets in zijn strengste vorm — twee
   *  documenten, met hun datum, voor één bedrag. */
  kruisingTweeBenen(a: {
    amountCents: number; date: string; fromLabel: string; toLabel: string;
    uitLabel: string; uitDate: string; uitCents: number;
    inLabel: string; inDate: string; inCents: number;
  }): string[] {
    // De richting staat er in WOORDEN en niet als minteken voor een bedrag:
    // "€ -4.300,00 op BV1" is te lezen als een negatief saldo in plaats van als
    // een afschrijving. De bedragen zelf zijn de twee transacties, allebei
    // genoemd, want dat zijn de twee documenten waar dit cijfer uit komt.
    return [
      `${euro(a.amountCents)} · ${a.date} · ${a.fromLabel} → ${a.toLabel}. Beide kanten staan in je vault: er ging ${euro(Math.abs(a.uitCents))} van ${a.uitLabel} af op ${a.uitDate}, en er kwam ${euro(Math.abs(a.inCents))} op ${a.inLabel} binnen op ${a.inDate}.`,
    ];
  },

  /** Eén rij met maar één been. Drie dingen staan er verplicht bij: de OORZAAK
   *  (een rekening die niet geïmporteerd is laat geen tegenboeking achter), het
   *  BEWIJS waarom deze rij toch meetelt, en het feit dat hij één keer meetelt
   *  in het totaal erboven — anders leest een lezer een dubbeltelling waar er
   *  geen is. Eindigt in een vraag, want dit is precies wat LaVega niet ziet. */
  kruisingEenBeen(a: {
    amountCents: number; date: string; fromLabel: string; toLabel: string;
    evidence: CrossScopeEvidence; uitgaand: boolean;
  }): string[] {
    return [
      `${euro(a.amountCents)} · ${a.date} · ${a.fromLabel} → ${a.toLabel}. LaVega ziet geen tegenboeking in je vault: een rekening die je niet geïmporteerd hebt, laat er geen achter. ${EVIDENCE_REASON[a.evidence]} Eén kant is dus gemeten, en dit bedrag telt één keer mee in het totaal hierboven. ${a.uitgaand ? "Waar kwam dit terecht?" : "Waar kwam dit vandaan?"}`,
    ];
  },

  /** Wat de lijst niet toont maar wel meetelt. */
  meerRijen(a: { hidden: number; shown: number; count: number }): string[] {
    return [
      `De lijst toont de ${a.shown} grootste van ${a.count}; de andere ${a.hidden} staan er niet bij, maar tellen wel mee in het totaal hierboven.`,
    ];
  },

  /** WAT ER BUITEN DE METING VIEL. Dit blok hoort onlosmakelijk bij het totaal:
   *  core geeft `unseen` op elke uitkomst mee juist zodat een scherm geen totaal
   *  kan tonen zonder zijn eigen uitzonderingen in de hand te hebben. */
  uitgesloten(a: { noAccount: number; noEntity: number; currencyMismatch: number; mirrorSuppressed: number }): string[] {
    const out: string[] = [];
    if (a.noAccount > 0) {
      out.push(
        `${a.noAccount} transactie${a.noAccount === 1 ? "" : "s"} in dit venster ${a.noAccount === 1 ? "staat" : "staan"} op een rekening die niet in je vault staat. Die hoort bij geen enkele onderneming en telt hier dus niet mee.`,
      );
    }
    if (a.noEntity > 0) {
      out.push(
        `${a.noEntity} transactie${a.noEntity === 1 ? "" : "s"} ${a.noEntity === 1 ? "staat" : "staan"} op een rekening waar nog geen onderneming bij ingevuld is. Zolang dat veld leeg is, kan LaVega niet zeggen aan welke kant van de grens die rekening hoort, en “privé” invullen zou een aanname zijn.`,
      );
    }
    if (a.currencyMismatch > 0) {
      out.push(
        `Bij ${a.currencyMismatch} afschrijving${a.currencyMismatch === 1 ? "" : "en"} stond aan de andere kant van de grens hetzelfde bedrag in een andere valuta. LaVega koppelt die niet: daarvoor zou het een wisselkoers invullen die het niet gemeten heeft. Een echte omwisseling heeft aan twee kanten een verschillend bedrag en valt hier helemaal buiten, dus dit aantal is een ondergrens.`,
      );
    }
    if (a.mirrorSuppressed > 0) {
      out.push(
        `${a.mirrorSuppressed} rij${a.mirrorSuppressed === 1 ? "" : "en"} telt LaVega één keer in plaats van twee: aan beide kanten van de grens stond hetzelfde bedrag in dezelfde richting, te ver uit elkaar om als één overboeking gekoppeld te worden. Dubbel tellen is de fout die je niet ziet; te weinig tellen is de fout die hier staat.`,
      );
    }
    // Deze regel gaat over het PLAATSEN van een rij op een onderneming en over
    // niets anders. Hij stond er eerder als "kon LaVega op een onderneming
    // plaatsen", vlak boven een blok dat vertelt welke rekeningnummers LaVega
    // juist NIET kon plaatsen — twee betekenissen van hetzelfde woord onder
    // elkaar, waarvan de eerste als volledigheidsclaim te lezen was.
    if (out.length === 0) out.push("Elke transactie in dit venster stond op een rekening die bij een onderneming hoort.");
    return out;
  },

  /** Twee zakelijke ondernemingen onderling steken de grens niet over. Staat er
   *  omdat het anders lijkt of het vergeten is. */
  tussenZakelijk(a: { business: readonly string[] }): string[] {
    return [
      `Overboekingen tussen ${listNl(a.business)} staan hier niet: die zijn allemaal als zakelijk gemarkeerd, dus ze steken de grens niet over.`,
    ];
  },

  /** HET BIJPRODUCT — één tegenpartij aan beide kanten van de grens. De laatste
   *  halve zin is dragend: hij is het verschil tussen een meting en Richting C,
   *  die op de gegevens van vandaag niet te onderbouwen is (sectie 5). Zonder
   *  factuur is er niets terug te vragen, dus staat hier geen woord over
   *  aftrekbaarheid, en het retourtype van core draagt er ook geen veld voor. */
  bijproductKop(a: { rows: number }): string[] {
    if (a.rows === 0) return ["Geen enkele tegenpartij komt in dit venster op zowel een privérekening als een zakelijke rekening voor."];
    return [
      `${a.rows} tegenpartij${a.rows === 1 ? "" : "en"} ${a.rows === 1 ? "komt" : "komen"} in dit venster op zowel een privérekening als een zakelijke rekening voor. Dat is één naam op twee rekeningen — gemeten, en het zegt niets over aftrekbaarheid.`,
      "Een bank, een telefoonmaatschappij of een verzekeraar staat daar met recht tussen. LaVega filtert die niet weg: een uitzonderingenlijst is hoe een meting stilletjes een mening wordt.",
    ];
  },

  bijproductRij(a: {
    label: string; personalCount: number; personalCents: number;
    businessCount: number; businessCents: number; firstDate: string; lastDate: string;
  }): string[] {
    return [
      `${a.label}: ${a.personalCount} betaling${a.personalCount === 1 ? "" : "en"} van ${a.personalCount === 1 ? "" : "samen "}${euro(a.personalCents)} vanaf een privérekening en ${a.businessCount} van ${a.businessCount === 1 ? "" : "samen "}${euro(a.businessCents)} vanaf een zakelijke rekening, tussen ${a.firstDate} en ${a.lastDate}. Horen die privébetalingen bij je onderneming?`,
    ];
  },

  /** De uitleg boven het antwoordformulier. Geen toestemmingsstap, en dat is
   *  bewust: bij de AI-categorisatie bestaat die stap omdat er tekst naar Claude
   *  gaat (Transacties.tsx). Hier wordt lokaal gemeten en lokaal bewaard, dus
   *  een toestemmingsvraag zou theater zijn. Wat er wél moet staan is wat een
   *  antwoord DOET — namelijk niets aan de bedragen. */
  antwoordUitleg(a: { streams: number }): string[] {
    return [
      `${a.streams} stroom${a.streams === 1 ? "" : "en"} zonder antwoord. Per stroom één vraag, niet per overboeking.`,
      "Je antwoord wordt in je versleutelde vault bewaard en gaat nergens heen: het verandert geen enkel bedrag hierboven, LaVega zet het ernaast. Laat “nog niet beantwoord” staan bij wat je nu niet weet — “weet ik niet” is ook een antwoord, en daarna wordt er niet meer naar gevraagd.",
    ];
  },

  antwoordNotitie(a: { saved: number }): string[] {
    if (a.saved === 0) return ["Niets bewaard: er stond nog geen antwoord ingevuld."];
    return [
      `${a.saved} stroom${a.saved === 1 ? "" : "en"} beantwoord en in je vault bewaard. De gemeten bedragen hierboven zijn er niet door veranderd.`,
    ];
  },

  /** De vaste voetregel van de module. */
  voet(): string[] {
    return [
      "Deze module meet wat er tussen je ondernemingen en je privérekeningen bewoog, in centen en op datum. Ze rekent geen belasting uit en trekt geen conclusie over wat een overboeking betekent — wat LaVega hier niet berekent, staat in “Niet berekend” hieronder.",
    ];
  },

  /** De vaste tekst van het antwoordformulier (fase "review"): kolomkoppen,
   *  de selectie-opties en de twee knoppen. Geen zinnen maar losse etiketten —
   *  en toch hier, en niet als losse stringliteral in de JSX. `renderToStaticMarkup`
   *  rendert nooit fase "review" (`phase` is component-state, niet een prop, en
   *  er is geen React Testing Library in dit pakket om een klik te simuleren),
   *  dus dit is de plek waar een latere, hulpvaardige zin het scherm ongezien
   *  zou kunnen bereiken — precies wat de audit van 25 augustus 2026 aanwees.
   *  Door hier te staan loopt `GRENS_COPY_SAMPLES` hem wél af: die tabel is
   *  typegedwongen op elke sleutel van `GRENS_COPY` en heeft geen render nodig. */
  reviewChrome(): string[] {
    return [
      "Stroom", "Gemeten", "Wat was dit?",
      "nog niet beantwoord", "Salaris", "Dividend", "Weet ik niet",
      "Bewaar antwoorden", "Annuleer",
    ];
  },
} as const;

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
  allAccounts, allTxs, entityProfiles, asOf, ownNames, answers, busy, onSaveAnswers,
}: GrensProps) {
  // idle → review → idle. Geen `consent`-fase: die bestaat bij de
  // AI-categorisatie omdat er data naar een model gaat, en hier gaat er niets
  // weg. Wat blijft is de bevestigstap zelf: niets wordt bewaard zonder klik.
  const [phase, setPhase] = useState<"idle" | "review">("idle");
  const [drafts, setDrafts] = useState<Record<string, CrossScopeKind | "">>({});
  const [note, setNote] = useState<string | null>(null);

  const input = useMemo(
    () => ({ accounts: allAccounts, txs: allTxs, profiles: entityProfiles, asOf, names: ownNames, answers }),
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

  const footer = <span>{GRENS_COPY.voet()[0]}</span>;

  // ── De drie toestanden waarin er niets te meten viel ──────────────────────
  if (report.state !== "gemeten") {
    const lines =
      report.state === "geen-zakelijke-entiteit"
        ? GRENS_COPY.geenZakelijkeEntiteit({ unclassified: report.entities.unclassified, personal: report.entities.personal })
        : report.state === "geen-persoonlijke-entiteit"
          ? GRENS_COPY.geenPersoonlijkeEntiteit({ business: report.entities.business })
          : GRENS_COPY.geenTransacties({
              business: report.entities.business,
              personal: report.entities.personal,
              from: report.window.from,
              to: report.window.to,
            });
    return (
      <Module title="Privé en zakelijk" span={2} footer={footer}>
        <div data-testid={`grens-${report.state}`}>{paragraphs(lines, "leeg")}</div>
        {report.state === "geen-transacties" &&
          paragraphs(GRENS_COPY.uitgesloten({ ...report.unseen, currencyMismatch: 0, mirrorSuppressed: 0 }), "uitgesloten")}
      </Module>
    );
  }

  const { crossings, streams, observed, window: win, unseen } = report;

  // Stromen gegroepeerd op de ZAKELIJKE onderneming. Bij elke kruising is
  // precies één kant zakelijk (core matcht alleen tegengestelde kanten), dus
  // die keuze is eenduidig — en het is dezelfde onderneming waarop het antwoord
  // straks wordt bewaard.
  const businessOf = (s: { fromEntity: string | null; toEntity: string | null; fromScope: EntityScope }): string =>
    (s.fromScope === "business" ? s.fromEntity : s.toEntity) ?? "";

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
    setNote(GRENS_COPY.antwoordNotitie({ saved: rows.length })[0]);
  }

  const costRows: readonly PrivatelyPaidCostRow[] = costs.state === "gemeten" ? costs.rows : [];

  return (
    <Module title="Privé en zakelijk" height="tall" span={2} footer={footer}>
      {crossings.length === 0 ? (
        <div data-testid="grens-niets-gekruist">
          {paragraphs(
            GRENS_COPY.nietsGekruist({ from: win.from, to: win.to, obsFrom: observed.from, obsTo: observed.to }),
            "niets",
          )}
        </div>
      ) : (
        <>
          {/* De herkomstregel hoort bij het VENSTER en niet bij een stroom, dus
              staat hij één keer bovenaan. Per stroom herhalen maakte hem ruis,
              en ruis is precies hoe een herkomstregel ophoudt gelezen te worden. */}
          {paragraphs(
            GRENS_COPY.herkomst({
              from: win.from, to: win.to, obsFrom: observed.from, obsTo: observed.to,
              pairWindowDays: CROSS_SCOPE_PAIR_WINDOW_DAYS,
            }),
            "herkomst",
          )}
          {groups.map(([entity, entityStreams]) => (
          <div className="tax-entity" key={entity || "zonder-naam"}>
            <div className="tax-entity-head">
              <span className="tax-entity-name">{entity}</span>
            </div>
            {entityStreams.map((s) => {
              const rows = crossingsByStream.get(s.key) ?? [];
              const shown = rows.slice(0, MAX_ROWS_PER_STREAM);
              const fromLabel = sideLabel(s.fromEntity, s.fromScope);
              const toLabel = sideLabel(s.toEntity, s.toScope);
              return (
                <div className="grens-stroom" key={s.key}>
                  {paragraphs(
                    GRENS_COPY.stroomKop({
                      fromLabel, toLabel, count: s.count,
                      totalCents: s.totalCents, matchedCents: s.matchedCents, unmatchedCents: s.unmatchedCents,
                      knownCents: s.totalCents - s.unknownCents, unknownCents: s.unknownCents,
                    }),
                    `kop-${s.key}`,
                  )}
                  {s.kindSource !== null &&
                    paragraphs(
                      GRENS_COPY.stroomAntwoord({
                        kind: s.kind, source: s.kindSource, at: answerDate(s.key),
                        count: s.count, firstDate: s.firstDate, lastDate: s.lastDate,
                      }),
                      `antwoord-${s.key}`,
                    )}
                  {s.unknownCount > 0 &&
                    paragraphs(
                      GRENS_COPY.stroomVraag({
                        fromLabel, toLabel, unknownCents: s.unknownCents,
                        unknownCount: s.unknownCount,
                        // De datum van de laatste ONBEANTWOORDE overboeking, niet
                        // die van de stroom: die twee lopen uiteen zodra één rij
                        // wel een antwoord heeft, en dan zou de zin naar een rij
                        // wijzen waar de vraag niet over gaat.
                        lastDate: rows.reduce((d, c) => (c.kind === "onbekend" && c.date > d ? c.date : d), s.firstDate),
                      }),
                      `vraag-${s.key}`,
                    )}
                  <div className="grens-rijen">
                    {shown.map((c) => (
                      <div className="grens-rij" key={c.id}>
                        {paragraphs(crossingLines(c), `rij-${c.id}`)}
                      </div>
                    ))}
                  </div>
                  {rows.length > shown.length &&
                    paragraphs(
                      GRENS_COPY.meerRijen({ hidden: rows.length - shown.length, shown: shown.length, count: rows.length }),
                      `meer-${s.key}`,
                    )}
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
        GRENS_COPY.dekking({
          unknownCounterAccount: report.unknownCounterAccount,
          ownNameKnown: report.ownNameKnown,
        }),
        "dekking",
      )}

      {report.entities.business.length > 1 &&
        paragraphs(GRENS_COPY.tussenZakelijk({ business: report.entities.business }), "tussen")}

      {paragraphs(
        GRENS_COPY.uitgesloten({
          noAccount: unseen.noAccount, noEntity: unseen.noEntity,
          currencyMismatch: report.currencyMismatch, mirrorSuppressed: report.mirrorSuppressed,
        }),
        "uitgesloten",
      )}

      {/* ── De vragenlijst. Bevestigen-eerst: het keuzemenu bewerkt alleen een
           lokaal concept, en pas "Bewaar antwoorden" schrijft iets weg. ─────── */}
      {unanswered.length > 0 && phase === "idle" && (
        <div className="stack-form-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => { setNote(null); setPhase("review"); }}>
            Beantwoord {unanswered.length} stroom{unanswered.length === 1 ? "" : "en"}
          </button>
        </div>
      )}

      {phase === "review" && (() => {
        const [kolomStroom, kolomGemeten, kolomWatWasDit, nogNietBeantwoord, salarisLabel, dividendLabel, onbekendLabel, bewaarLabel, annuleerLabel] =
          GRENS_COPY.reviewChrome();
        return (
        <div className="ai-extract" style={{ margin: "var(--sp-3) 0" }}>
          {paragraphs(GRENS_COPY.antwoordUitleg({ streams: unanswered.length }), "uitleg")}
          <div className="table-wrap table-cards">
            <table className="table">
              <thead>
                <tr>
                  <th>{kolomStroom}</th>
                  <th>{kolomGemeten}</th>
                  <th>{kolomWatWasDit}</th>
                </tr>
              </thead>
              <tbody>
                {unanswered.map((s) => {
                  const label = `${sideLabel(s.fromEntity, s.fromScope)} → ${sideLabel(s.toEntity, s.toScope)}`;
                  return (
                    <tr key={s.key}>
                      <td data-label={kolomStroom}>{label}</td>
                      <td data-label={kolomGemeten}>
                        {euro(s.totalCents)} · {s.count}× · {s.firstDate} t/m {s.lastDate}
                      </td>
                      <td data-label={kolomWatWasDit}>
                        <select
                          value={drafts[s.key] ?? ""}
                          disabled={busy}
                          aria-label={`Wat was ${label}`}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [s.key]: e.target.value as CrossScopeKind | "" }))
                          }
                        >
                          <option value="">{nogNietBeantwoord}</option>
                          <option value="salaris">{salarisLabel}</option>
                          <option value="dividend">{dividendLabel}</option>
                          <option value="onbekend">{onbekendLabel}</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={saveAnswers}>
            {bewaarLabel}
          </button>{" "}
          <button type="button" className="btn" disabled={busy} onClick={() => { setDrafts({}); setPhase("idle"); }}>
            {annuleerLabel}
          </button>
        </div>
        );
      })()}
      {note && <p className="cell-sub" role="alert">{note}</p>}

      {/* ── Het bijproduct ────────────────────────────────────────────────── */}
      <div className="tax-entity" data-testid="grens-bijproduct">
        <div className="tax-entity-head">
          <span className="tax-entity-name">Zakelijke kosten van een privérekening</span>
        </div>
        {paragraphs(GRENS_COPY.bijproductKop({ rows: costRows.length }), "bijproduct-kop")}
        {costRows.map((r) => (
          <div key={r.merchant}>{paragraphs(GRENS_COPY.bijproductRij(r), `bijproduct-${r.merchant}`)}</div>
        ))}
      </div>
    </Module>
  );
}

/** De zin(nen) van één overboeking. Buiten de component gehouden zodat de
 *  woordtest hem los kan aanroepen zonder een render. */
function crossingLines(c: CrossScopeCrossing): string[] {
  const fromLabel = sideLabel(c.fromEntity, c.fromScope);
  const toLabel = sideLabel(c.toEntity, c.toScope);
  if (c.matched && c.legs.length === 2) {
    const uit: CrossScopeLeg = c.legs[0].signedCents < 0 ? c.legs[0] : c.legs[1];
    const bij: CrossScopeLeg = uit === c.legs[0] ? c.legs[1] : c.legs[0];
    return GRENS_COPY.kruisingTweeBenen({
      amountCents: c.amountCents, date: c.date, fromLabel, toLabel,
      uitLabel: uit.entity, uitDate: uit.date, uitCents: uit.signedCents,
      inLabel: bij.entity, inDate: bij.date, inCents: bij.signedCents,
    });
  }
  return GRENS_COPY.kruisingEenBeen({
    amountCents: c.amountCents, date: c.date, fromLabel, toLabel,
    evidence: c.evidence, uitgaand: (c.legs[0]?.signedCents ?? 0) < 0,
  });
}
