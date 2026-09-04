export type PriceSyncProgress = {
  status: "idle" | "running" | "waiting" | "paused" | "completed" | "problem";
  total: number;
  completed: number;
  remainingSymbols: string[];
  currentSymbol: string | null;
  waitUntil: string | null;
  updatedAt: string | null;
  message: string | null;
  problems: string[];
};

export const DASHBOARD_REFRESH_EVENT = "lavega:dashboard-refresh";

/* De server doet per aanroep zoveel symbolen als er tijd is en zet de rest
   klaar; werk dat na het antwoord doorloopt, overleeft een serverless functie
   niet. "paused" betekent dus: nog niet klaar, vraag opnieuw. De limiet is een
   noodrem, geen verwachting — elke ronde is korter dan de vorige omdat al
   opgehaalde symbolen worden overgeslagen. */
const MAX_ROUNDS = 40;

/* Een ronde kan worden afgekapt voordat de server antwoordt: Cloudflare sluit
   een aanvraag na ongeveer 100 seconden af (524) terwijl de server doorwerkt
   en zijn voortgang gewoon wegschrijft. Opnieuw vragen pakt die voortgang op.
   Blijft het misgaan, dan is het geen afkapping maar een storing. */
const MAX_INTERRUPTIONS = 3;

/** Vraagt net zo lang om prijssynchronisatie tot de server klaar is. */
export async function runPriceSyncUntilComplete(
  current: () => boolean = () => true,
): Promise<string[]> {
  const failed = ["Prijsgeschiedenis kon niet worden bijgewerkt."];
  let interruptions = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await fetch("/api/prices/sync", { method: "POST" }).catch(() => null);
    // Zonder Yahoo-toestemming is niets ophalen het juiste antwoord, geen fout.
    if (response?.status === 428) return [];
    if (response && response.status >= 400 && response.status < 500) return failed;
    const progress = response
      ? ((await response.json().catch(() => null)) as PriceSyncProgress | null)
      : null;
    if (!current()) return [];
    if (progress && typeof window !== "undefined")
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    if (!response?.ok && response?.status !== 202) {
      interruptions += 1;
      if (interruptions >= MAX_INTERRUPTIONS) return failed;
      continue;
    }
    if (progress?.status === "paused") continue;
    /* Alles behalve "paused" is een eindantwoord voor deze aanroeper: klaar,
       of een run die elders al loopt en die deze pagina niet moet verdubbelen.
       Alleen een afgeronde run heeft problemen om te melden. */
    return progress?.status === "completed" || progress?.status === "problem"
      ? progress.problems
      : [];
  }
  return [];
}
