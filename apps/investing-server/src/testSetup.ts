import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ELKE TESTWORKER KRIJGT ZIJN EIGEN RUNTIME-MAP.
 *
 * `runtimeDataFile` valt zonder override terug op `process.cwd()/.lavega`, en
 * dat is ÉÉN map voor de hele suite. Een test die geen store injecteert schrijft
 * daar dus, terwijl een andere test zijn eigen tijdelijke mappen opruimt — en
 * op een trage of zwaarder parallelle machine landt die opruiming tussen de
 * `writeFile` en de `rename` van de eerste. Dat is precies wat CI liet zien:
 *
 *   ENOENT: rename '.lavega/agent-run.json.tmp' -> '.lavega/agent-run.json'
 *
 * met vijf tests die daarna in hun time-out liepen. Lokaal viel het vier volle
 * runs lang niet te reproduceren, want dat hangt aan timing en aan het aantal
 * workers.
 *
 * Per worker en niet per bestand: vitest draait bestanden binnen één worker na
 * elkaar, dus één map per worker volstaat en houdt het aantal tijdelijke mappen
 * laag. De vlag hieronder voorkomt dat een tweede setup-run hem verplaatst.
 *
 * Dit lost de SOORT fout op en niet het geval: elke store die op
 * `runtimeDataFile` leunt is hierdoor geïsoleerd, ook de volgende die iemand
 * toevoegt zonder aan testisolatie te denken. */
const RUNTIME_FILES: ReadonlyArray<[string, string]> = [
  ["LAVEGA_AGENT_RUN_FILE", "agent-run.json"],
  ["LAVEGA_BROKER_SYNC_STATE_FILE", "broker-sync-state.json"],
  ["LAVEGA_VAULT_FILE", "credentials.json"],
  ["INVESTING_BENCHMARK_STORE_FILE", "benchmarks.json"],
  ["INVESTING_MARKET_DATA_CONSENT_FILE", "market-data-consent.json"],
  ["INVESTING_SECTOR_STORE_FILE", "sectors.json"],
];

if (!process.env.LAVEGA_TEST_RUNTIME_DIR) {
  const directory = mkdtempSync(join(tmpdir(), "lavega-investing-test-"));
  process.env.LAVEGA_TEST_RUNTIME_DIR = directory;
  for (const [variable, fileName] of RUNTIME_FILES) {
    // Een test die zelf een pad zet houdt dat pad.
    if (!process.env[variable]?.trim()) process.env[variable] = join(directory, fileName);
  }
}
