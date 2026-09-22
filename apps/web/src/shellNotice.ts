import type { ImportProblem } from "@lavega/core";

/* Wat de balk bovenin te melden heeft — als KIND, niet als zin.
 *
 * Dit was `string[]`, en elke producent bouwde zijn eigen Nederlandse zin op de
 * plek waar het misging: "Bankkoppeling mislukt: …", "Bank gekoppeld: …",
 * "Importeren mislukt: …". Die balk is het eerste wat iemand ziet na een
 * bankkoppeling of een import, dus het was ook de eerste plek waar een Engelse
 * lezer Nederlands kreeg. De zinnen staan nu in `copy/shell`; hier staat wat er
 * gebeurd is en het ene feit dat de zin nodig heeft.
 *
 * `detail` is met opzet ONVERTAALD: het is de tekst van de server of van een
 * uitzondering, en die verzinnen we hier niet opnieuw. Hij hangt achter een
 * zin die wel vertaald is, zodat de lezer in elk geval weet WAT er misging. */
export type ShellNotice =
  | { kind: "import-problem"; problem: ImportProblem }
  | { kind: "bank-link-failed"; detail: string }
  | { kind: "bank-linked"; accounts: number; aspsp: string; txs: number }
  | { kind: "import-failed"; detail: string }
  | { kind: "terms-lookup-failed"; detail: string }
  /** De toestemming van deze bank is verlopen; opnieuw koppelen is de enige weg
   *  terug. Een eigen kind en geen `bank-link-failed`, omdat er niets kapot is:
   *  de termijn is gewoon om, en dat vraagt een andere handeling dan "probeer
   *  het opnieuw". */
  | { kind: "bank-consent-expired"; aspsp: string }
  /** Er viel niets te verversen — er is geen bankkoppeling. Gezegd en niet
   *  stilgehouden: een knop die niets doet zonder uitleg leest als kapot. */
  | { kind: "bank-nothing-to-refresh" };

/** Een parserprobleem als melding voor de balk. */
export const importNotices = (problems: readonly ImportProblem[]): ShellNotice[] =>
  problems.map((problem) => ({ kind: "import-problem", problem }));
