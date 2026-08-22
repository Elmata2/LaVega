/* FX rate service. GET /api/fx/rate serves this.
 *
 * TWEE LAGEN, EN ZE ZIJN NIET HETZELFDE WAARD.
 *
 * De ECB publiceert REFERENTIEKOERSEN: één instelling, één vast tijdstip, een
 * methode die je kunt nalezen. Dat zijn er 29. Een aggregator voegt koersen
 * samen uit bronnen die hij niet noemt en ververst één keer per dag. Dat zijn er
 * 166. Allebei bruikbaar, niet inwisselbaar — dus komen ze er allebei in, maar
 * met hun herkomst eraan vast:
 *
 *   laag 1  ECB via Frankfurter        api.frankfurter.dev   29 valuta
 *   laag 2  ExchangeRate-API (open)    open.er-api.com      166 valuta
 *
 * DE VOORRANG, van sterk naar zwak. Elke koers komt van de eerste laag in deze
 * rij die hem heeft; wie later komt vult alleen wat er nog niet is.
 *
 *   1. ECB, deze ronde opgehaald
 *   2. ECB, de laatste geslaagde ophaal van dit proces  (`ecbGood`)
 *   3. de aggregator, deze ronde opgehaald
 *   4. de meegebundelde momentopname (FX_RATE_FALLBACK)
 *
 * Waarom 3 boven 4 staat en de bundel dus NIET altijd wint: de bundel is geen
 * bron maar een vloer. Een dollarkoers van begin augustus voorrang geven boven
 * de koers van vandaag zou precies de oude-waarde-als-vers opleveren die dit
 * bestand elders bewaakt. Waar de ECB vandaag of vanochtend antwoordde wint hij
 * wél, altijd — punt 1 en 2 staan bewust boven punt 3.
 *
 * DE TWEEDE LAAG HEEFT GEEN GEHEUGEN, en dat is met opzet. Voor de ECB bewaren we
 * de laatste geslaagde ophaal (`ecbGood`), zodat een hikje bij Frankfurter niet
 * meteen de hele tab leegtrekt. Voor de aggregator doen we dat NIET: valt hij weg,
 * dan verdwijnen zijn koersen uit het antwoord en is het antwoord weer "geen
 * koers". Dat is de bedoeling. Een bewaarde aggregatorkoers zou zich als vers
 * voordoen terwijl niemand meer weet hoe oud hij is, en dat is erger dan een
 * valuta die vandaag niet te wisselen valt. Om dezelfde reden is de oude
 * "bij een fout het laatste hele antwoord opnieuw serveren"-tak weg: die
 * bewaarde ook de tweede laag.
 *
 * ER GAAT GEEN GEBRUIKERSDATA NAAR BUITEN. Beide aanroepen halen de HELE TABEL in
 * één keer op — geen verzoek per valuta en geen verzoek per land. Dat verschil is
 * de reden dat dit hier mag terwijl de wereldkaart in de bol meegebundeld is: een
 * tegelverzoek of een koersverzoek per munt zou de bron vertellen waar iemand
 * naar kijkt ("waar ga ik heen"), een tabelverzoek vertelt alleen dat er íemand
 * op deze server naar koersen kijkt.
 *
 * ATTRIBUTIE. De open-access-koersen van ExchangeRate-API mogen alleen gebruikt
 * worden mét zichtbare vermelding (exchangerate-api.com/docs/free, nagekeken
 * 22 augustus 2026: "We require attribution on the pages you're using these
 * rates with"). Die vermelding staat in de UI, niet hier — zie
 * apps/web/src/views/Valuta.tsx. Deze regel is de verwijzing, niet de vermelding.
 * Let op bij het wisselen van bron: de algemene voorwaardenpagina
 * (exchangerate-api.com/terms) zwijgt over attributie; alleen de docs van de
 * gratis laag noemen de plicht. Wie alleen /terms leest, leest het niet.
 */
import type { FxRate } from "@lavega/core";
import { FX_RATE_FALLBACK, parseFxRatePayload } from "@lavega/core";

const ECB_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
const AGGREGATOR_URL = "https://open.er-api.com/v6/latest/EUR";

/** De munt waarin beide lagen genoteerd staan. Een laag die iets anders zegt
 *  wordt geweigerd in plaats van omgerekend: door elkaar heen rekenen met twee
 *  bases is precies hoe je een koers krijgt die niemand kan narekenen. */
const BASE = "EUR";

const TTL_MS = 6 * 60 * 60 * 1000;

/** De ECB krijgt 8 seconden, de aggregator 6. Beide aanroepen lopen tegelijk, dus
 *  het antwoord duurt zo lang als de traagste — en de tweede laag mag het antwoord
 *  nooit LANGER laten duren dan de eerste laag alleen al deed. Vandaar strikt
 *  minder dan 8 en niet "hetzelfde, dat is netjes". */
const ECB_TIMEOUT_MS = 8000;
const AGGREGATOR_TIMEOUT_MS = 6000;

/** Welke laag deze koers leverde. Staat per valutacode in het antwoord, want twee
 *  koersen naast elkaar zonder dit onderscheid is de vermenging die we vermijden. */
export type FxOrigin = "ecb" | "aggregator";

/** Hoe vers een laag is. `geheugen` is een ECHTE ophaal van dit proces waarvan de
 *  laatste poging mislukte — dat is iets anders dan `live` en iets anders dan de
 *  meegebundelde `bundel`, en de UI zegt alle drie verschillend. */
export type FxLayerStatus = "live" | "geheugen" | "bundel";

export type FxLayer = {
  status: FxLayerStatus;
  /** De peildatum die de bron zelf noemt (JJJJ-MM-DD). */
  date: string;
  /** Hoeveel koersen in `rates` daadwerkelijk VAN DEZE LAAG komen. Geteld na het
   *  samenvoegen en niet overgenomen uit de bron: een laag die 166 koersen
   *  aanleverde maar er 137 mocht bijdragen, heeft er 137 bijgedragen. */
  count: number;
};

export type FxAggregatorLayer = FxLayer & {
  /** Identificatie van de aanbieder. De UI hangt hier de verplichte vermelding
   *  aan op; de tekst en de link staan daar, zodat de vermelding niet afhangt van
   *  wat de server toevallig meestuurt. */
  provider: "erapi";
  /** Wanneer de bron zegt de volgende ronde te publiceren, of null als hij dat
   *  niet zei. Niet verzinnen: zonder opgave weet de UI het niet. */
  nextUpdate: string | null;
};

export type FxLayers = {
  /** null zodra de ECB-laag geen enkele koers in dit antwoord leverde. */
  ecb: FxLayer | null;
  aggregator: FxAggregatorLayer | null;
};

/** Het antwoord van /api/fx/rate. Een FxRate met de herkomst erbij; `parseFxRatePayload`
 *  uit core leest alleen base/date/rates en negeert de rest, dus een oudere client
 *  blijft werken en ziet gewoon één ongelabelde lijst. */
export type LayeredFxRate = FxRate & {
  /** Valutacode -> welke laag hem leverde. Bevat exact dezelfde sleutels als `rates`. */
  origins: Record<string, FxOrigin>;
  layers: FxLayers;
};

/** Het laatste GESLAAGDE ECB-antwoord van dit proces. Bewust geen aggregator-variant. */
let ecbGood: FxRate | null = null;
/** Het samengestelde antwoord, zolang het vers is. Alleen een TTL-cache: hij wordt
 *  NIET als terugval bij een storing geserveerd, want dan zou hij de tweede laag
 *  levend houden nadat die weggevallen is. */
let served: { payload: LayeredFxRate; at: number } | null = null;

async function fetchEcb(): Promise<FxRate | null> {
  try {
    const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(ECB_TIMEOUT_MS) });
    if (!res.ok) return null;
    const parsed = parseFxRatePayload(await res.json());
    // Een andere base kunnen we niet samenvoegen met de tweede laag. Weigeren.
    return parsed && parsed.base === BASE ? parsed : null;
  } catch {
    return null;
  }
}

type AggregatorPayload = { date: string; nextUpdate: string | null; rates: Record<string, number> };

/** De RFC-1123-tijdstempel van de aggregator ("Sat, 22 Aug 2026 00:02:31 +0000")
 *  als JJJJ-MM-DD. Geeft null bij alles wat geen datum is — en dat is een
 *  weigering, geen "dan maar vandaag": een koers zonder eigen datum kan zijn
 *  herkomst niet dragen, en dat is precies wat deze laag moet doen. */
function isoDay(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** Valideert het open.er-api-antwoord. Null bij elk vormprobleem — inclusief een
 *  andere base of een ontbrekende peildatum, want zonder die twee is de koers niet
 *  te plaatsen naast de ECB-laag. */
export function parseAggregatorPayload(raw: unknown): AggregatorPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.result !== "success") return null;
  if (o.base_code !== BASE) return null;
  const date = isoDay(o.time_last_update_utc);
  if (!date) return null;
  if (!o.rates || typeof o.rates !== "object") return null;
  const rates: Record<string, number> = {};
  for (const [code, v] of Object.entries(o.rates as Record<string, unknown>)) {
    // Eén rotte koers maakt de hele laag verdacht, maar hem weggooien zou 165
    // goede koersen kosten. Dus: deze overslaan, de rest houden. Dat mag hier en
    // niet bij de ECB-laag, omdat core's parser daar de hele payload afkeurt —
    // een referentielijst met een gat is een ander soort probleem dan een
    // aggregator die één exotische munt niet rond krijgt.
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    rates[code] = v;
  }
  if (Object.keys(rates).length === 0) return null;
  return { date, nextUpdate: isoDay(o.time_next_update_utc), rates };
}

async function fetchAggregator(): Promise<AggregatorPayload | null> {
  try {
    const res = await fetch(AGGREGATOR_URL, { signal: AbortSignal.timeout(AGGREGATOR_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseAggregatorPayload(await res.json());
  } catch {
    return null;
  }
}

export async function getFxRate(): Promise<LayeredFxRate> {
  if (served && Date.now() - served.at < TTL_MS) return served.payload;

  const [ecb, aggregator] = await Promise.all([fetchEcb(), fetchAggregator()]);
  if (ecb) ecbGood = ecb;

  /** Een ECHTE ECB-ophaal: die van nu, anders die van eerder dit proces. */
  const ecbReal = ecb ?? ecbGood;

  const rates: Record<string, number> = {};
  const origins: Record<string, FxOrigin> = {};
  /** Wie er eerst is wint. De volgorde van de aanroepen hieronder IS de voorrang
   *  uit de kop van dit bestand; er is geen tweede plek waar die vastligt. */
  const fill = (src: Record<string, number>, origin: FxOrigin) => {
    for (const [code, v] of Object.entries(src)) {
      // De base is geen koers maar de eenheid. open.er-api zet EUR: 1 in de lijst;
      // dat als "koers van de aggregator" labelen zou de euro een herkomst geven
      // die hij niet heeft.
      if (code === BASE) continue;
      if (code in rates) continue;
      rates[code] = v;
      origins[code] = origin;
    }
  };

  if (ecbReal) fill(ecbReal.rates, "ecb");
  if (aggregator) fill(aggregator.rates, "aggregator");
  if (!ecbReal) fill(FX_RATE_FALLBACK.rates, "ecb");

  const counted = (origin: FxOrigin) => Object.values(origins).filter((o) => o === origin).length;
  const ecbCount = counted("ecb");
  const aggregatorCount = counted("aggregator");

  const ecbLayer: FxLayer | null =
    ecbCount === 0
      ? // Kan echt gebeuren: valt de ECB weg terwijl de aggregator staat, dan vult
        // die alles en draagt de bundel niets meer bij. Dan is er geen ECB-laag,
        // en dat hoort het scherm te zeggen in plaats van een lege laag te tonen.
        null
      : {
          status: ecb ? "live" : ecbReal ? "geheugen" : "bundel",
          date: ecbReal ? ecbReal.date : FX_RATE_FALLBACK.date,
          count: ecbCount,
        };

  const aggregatorLayer: FxAggregatorLayer | null =
    aggregator && aggregatorCount > 0
      ? {
          status: "live",
          date: aggregator.date,
          count: aggregatorCount,
          provider: "erapi",
          nextUpdate: aggregator.nextUpdate,
        }
      : null;

  /* De datum bovenaan is die van de STERKSTE laag die er ligt. Hij bestaat alleen
   * nog omdat FxRate hem vereist en een oudere client hem leest; wie de herkomst
   * per koers wil weten, leest `origins` en `layers`. Eén datum boven een lijst
   * met twee peildata zou hoe dan ook voor een deel van die lijst onwaar zijn. */
  const payload: LayeredFxRate = {
    base: BASE,
    date: ecbLayer?.date ?? aggregatorLayer?.date ?? FX_RATE_FALLBACK.date,
    rates,
    origins,
    layers: { ecb: ecbLayer, aggregator: aggregatorLayer },
  };

  // Alleen een antwoord waarin een bron DEZE RONDE antwoordde wordt vastgehouden.
  // Ook een antwoord uit `ecbGood` niet: dat is per definitie gebouwd nadat een
  // poging mislukte, en dat zes uur vasthouden zou een storing van een minuut een
  // halve dag laten duren. Zonder cache doet het volgende verzoek gewoon een
  // nieuwe poging.
  if (ecb || aggregator) served = { payload, at: Date.now() };
  return payload;
}

/** Alleen voor tests: gooit het geheugen van dit proces weg. De modulevariabelen
 *  overleven anders van de ene test naar de andere, en dan meet je de vorige. */
export function __resetFxCacheForTests(): void {
  ecbGood = null;
  served = null;
}
