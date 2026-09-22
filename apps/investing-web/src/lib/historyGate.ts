/* WANNEER EEN HALF GELADEN PORTEFEUILLE NIET GETOOND MAG WORDEN.
 *
 * Een geschiedenis komt in pagina's binnen, en een run die tegen de tijdslimiet
 * van de host aanloopt pauzeert met een cursor en hervat de volgende keer. Dat
 * deel werkt. Wat ontbrak is dat het DASHBOARD dat niet wist: het rekende door
 * op wat er toevallig al was.
 *
 * En dat is geen kleiner beeld maar een FOUT beeld. Rendement en kostprijs
 * worden uit `trades` afgeleid, dus met de helft van de transacties klopt het
 * rendement niet — het staat er alleen wel, met twee decimalen, alsof het klopt.
 * Een getal dat eruitziet als een antwoord is erger dan een spinner.
 *
 * Twee gevallen, en alleen het eerste is gevaarlijk:
 *
 *   · NOG NOOIT AFGEROND (`lastSyncedAt === null`) en er staat een cursor open
 *     → wat er ligt is een willekeurig deel van de geschiedenis. Niets tonen.
 *   · AL EENS AFGEROND en er staat een cursor open → `lastSyncedAt` schuift
 *     alleen op als er GEEN cursor overblijft (zie `scheduledSync`), dus dit is
 *     de laatste volledige stand plus nieuwe rijen. Samenvoegen gaat op id, dus
 *     dat is een superset: wel tonen, met de melding dat hij bijwerkt. */

export type BrokerHistory = {
  lastSyncedAt: string | null;
  ordersComplete: boolean;
  transactionsComplete: boolean;
  dividendsComplete: boolean;
};

export type HistoryProgress = Record<string, BrokerHistory>;

export type HistoryGate =
  /** Alles binnen, of een eerdere volledige stand om op terug te vallen. */
  | { kind: "ready"; updating: string[] }
  /** Eerste synchronisatie nog bezig: cijfers achterhouden. */
  | { kind: "first-sync"; brokers: string[] };

const pending = (h: BrokerHistory): boolean =>
  !(h.ordersComplete && h.transactionsComplete && h.dividendsComplete);

export function historyGate(history: HistoryProgress | null | undefined): HistoryGate {
  if (!history) return { kind: "ready", updating: [] };
  const entries = Object.entries(history);
  const firstSync = entries
    .filter(([, h]) => pending(h) && h.lastSyncedAt === null)
    .map(([broker]) => broker)
    .sort();
  if (firstSync.length > 0) return { kind: "first-sync", brokers: firstSync };
  const updating = entries
    .filter(([, h]) => pending(h))
    .map(([broker]) => broker)
    .sort();
  return { kind: "ready", updating };
}

/** How the broker is written on screen. */
export function brokerLabel(broker: string): string {
  return broker === "trading212" ? "Trading 212" : broker === "ibkr" ? "Interactive Brokers" : broker;
}
