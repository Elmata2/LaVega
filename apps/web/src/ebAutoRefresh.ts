const LAST_KEY = "lavega.ebLastRefreshAt";
const CONNECTED_KEY = "lavega.ebEverConnected";

/** Vier keer per dag. Zijn getal, en het is een bovengrens en geen belofte:
 *  verversen gebeurt alleen terwijl de app openstaat en de kluis open is. */
export const EB_AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;

/* WAAROM DIT IN DE BROWSER ZIT EN NIET IN EEN CRON.
 *
 * De voor de hand liggende bouw is een server-cron, vier keer per dag over alle
 * gebruikers. Die kan hier niet bestaan, en dat is geen tekortkoming maar het
 * hele ontwerp: transacties en saldi staan in de kluis in DEZE browser, en de
 * kopie op de server (`personal.vaults`) is één ondoorzichtige blob die met de
 * sleutel van de gebruiker is versleuteld. De server kan hem niet lezen en er
 * niets in schrijven. Een cron zou dus de bank kunnen bellen en het antwoord
 * vervolgens nergens kwijt kunnen.
 *
 * Wat er wél kan: zodra de app open en ontgrendeld is, kijken hoe lang het
 * geleden is en zo nodig meteen ophalen. Voor wie de app dagelijks opent is dat
 * hetzelfde resultaat; voor wie hem een maand dichtlaat is het dat niet, en dan
 * is "opgehaald op <datum>" naast het saldo het eerlijke antwoord in plaats van
 * een stilzwijgend oud getal. */

function readNumber(key: string): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

export function lastEbRefreshAt(): number {
  return readNumber(LAST_KEY);
}

/** Record that we TRIED, whatever came back.
 *
 *  THE STAMP BELONGS TO THE ATTEMPT AND NOT TO THE SUCCESS, and that is the
 *  whole point of it being a separate function. Stamping only on success looks
 *  tidier and is a retry loop: the timer's effect re-runs whenever `busy`
 *  changes, a failed refresh leaves the clock untouched, and so the very next
 *  re-run finds the refresh due again. Server down, rate limited, offline —
 *  each of those would become a tight loop of network calls that nothing in
 *  the browser stops.
 *
 *  A transient failure therefore costs a full interval's wait. That is the
 *  right trade: the manual button is always there, and a user pressing it is a
 *  better retry signal than a loop nobody asked for. */
export function markEbRefreshAttempted(now: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_KEY, String(now));
  } catch {
    /* quota/private mode — worst case is attempting again next tick */
  }
}

/** This browser has a bank. Separate from the stamp above because a refresh
 *  ATTEMPT proves nothing about whether a bank is connected, and marking a
 *  bankless browser as connected would start it polling forever. */
export function markBankConnected(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(CONNECTED_KEY, "1");
  } catch {
    /* quota/private mode — auto-refresh simply stays off */
  }
}

/** Of deze browser ooit een bank heeft gekoppeld. Zonder dit zou elke
 *  gebruiker die alleen bestanden importeert elke zes uur een verzoek sturen om
 *  te horen dat er niets te verversen valt. */
export function everConnectedBank(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Of er nu automatisch ververst mag worden.
 *
 *  `lastAt === 0` betekent "nog nooit" en niet "lang geleden": een browser die
 *  net een bank koppelde heeft de data al, en meteen opnieuw ophalen zou de
 *  koppeling verdubbelen in bankverkeer zonder iets toe te voegen. Daarom zet
 *  `markEbRefreshed` ook af bij het koppelen zelf. */
export function autoRefreshDue(p: {
  connected: boolean;
  lastAt: number;
  now: number;
  busy: boolean;
}): boolean {
  if (!p.connected || p.busy) return false;
  if (p.lastAt === 0) return false;
  return p.now - p.lastAt >= EB_AUTO_REFRESH_MS;
}
