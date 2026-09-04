import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { GMAIL_NODE_NAME, WORKFLOW_NAME, findQueueWebhookNode } from "./n8n-provision";
import { parseQueue } from "./n8n";

/* De regressiewacht op de factuur-workflow.
 * ─────────────────────────────────────────
 * Bron: docs/n8n/2026-08-24-workflow-diagnose.md. Die diagnose vond acht
 * bevindingen in de workflow. Ze zijn allemaal gerepareerd in de export in
 * docs/n8n/, en tot vandaag was dat één keer met de hand nagekeken: geen enkele
 * test las docs/n8n/lavega-facturen-workflow.json, en de ophaal-webhook (methode,
 * pad, responseMode, token, origins) werd nergens in de repo genoemd. Elke
 * bevinding kon dus geruisloos terugkomen bij de volgende keer dat iemand de
 * workflow in de n8n-UI opent en opnieuw exporteert.
 *
 * Dit bestand is die wacht. Per bevinding één `check…`-functie, met erboven wat
 * er in het echt breekt als hij omvalt. De functies staan los van de tests met
 * opzet: onderaan wordt elke belangrijke wacht ook op een MUTATIE van de goede
 * JSON gedraaid — de regressie kunstmatig teruggezet, in het geheugen, nooit op
 * schijf — en dan moet hij omvallen. Een wacht die alleen groen wordt op het
 * goede bestand bewijst niets.
 *
 * WAT DIT BESTAND NIET KAN. Het leest twee bestanden. Het zegt niets over de
 * workflow die in zíjn n8n draait: of die Actief staat, of de Header
 * Auth-credentials erin hangen, of hij /webhook/ en niet /webhook-test/ gebruikt.
 * Dat zijn de stappen 1–9 uit de diagnose en die blijven handwerk. Groen hier
 * betekent "de export in de repo is nog steeds goed", nooit "zijn n8n is goed".
 *
 * Geen jsdom-docblock: hier komt geen DOM aan te pas, en node:fs weigert de URL
 * die jsdom's eigen URL-klasse teruggeeft.
 */

/* ── de twee bestanden ──────────────────────────────────────────────────────
 *
 * Er zijn er twee, bijna identiek, en dat is precies waarom de gaten vielen.
 * `lavega-invoices.json` is de TEMPLATE die de app pusht (n8n-provision.ts
 * importeert hem) en het enige bestand dat tot nu toe getest werd;
 * `lavega-facturen-workflow.json` is de gecorrigeerde export die hij met de hand
 * importeert (stap 2 van de checklist). Elke invariant hieronder loopt over
 * BEIDE, want een reparatie die maar in één van de twee staat is geen reparatie.
 */
const QUEUE_FILE = "docs/n8n/lavega-facturen-workflow.json";
const TEMPLATE_FILE = "docs/n8n/lavega-invoices.json";
const FILES = [QUEUE_FILE, TEMPLATE_FILE] as const;

const REPO = new URL("../../../", import.meta.url);

type Edge = { node: string; type: string; index: number };
type Node = {
  id: string;
  name: string;
  type: string;
  parameters?: Record<string, any>;
  typeVersion?: number;
  position?: number[];
  webhookId?: string;
  notes?: string;
  notesInFlow?: boolean;
  onError?: string;
};
type Workflow = {
  name: string;
  nodes: Node[];
  connections: Record<string, { main: Edge[][] }>;
  settings?: Record<string, unknown>;
};

function rawText(rel: string): string {
  // Een rename van het bestand moet een zin opleveren, niet een ENOENT-stack.
  expect(existsSync(new URL(rel, REPO)), `${rel} is verdwenen of hernoemd`).toBe(true);
  return readFileSync(new URL(rel, REPO), "utf8");
}

function load(rel: string): Workflow {
  return JSON.parse(rawText(rel)) as Workflow;
}

/* ── gereedschap ─────────────────────────────────────────────────────────── */

const WEBHOOK = "n8n-nodes-base.webhook";
const CODE = "n8n-nodes-base.code";
const IF = "n8n-nodes-base.if";
const RESPOND = "n8n-nodes-base.respondToWebhook";
/** Alles wat een run kan STARTEN. Nodes van dit type mogen geen ingaande edge
 *  hebben; al het andere moet ergens vandaan komen. */
const TRIGGERS = [WEBHOOK, "n8n-nodes-base.manualTrigger", "n8n-nodes-base.scheduleTrigger"];

const MAIL_HOOK = "E-mail binnen";
const MAIL_NORM = "Normaliseer binnengekomen mail";
const QUEUE_HOOK = "LaVega vraagt de rij op";
const GMAIL_NORM = "Normaliseer bericht";
const IF_NODE = "Iets te lezen?";
const CLAUDE_REQ = "Bouw Claude-verzoek";
const NOTICE = "Melding: zelf ophalen";
const TO_LAVEGA = "Naar LaVega-vorm";
const ENQUEUE = "Zet in de wachtrij";
const HOURLY = "Elk uur";
const MANUAL = "Handmatig starten";

const MAIL_PATH = "lavega-mail-in";
const QUEUE_PATH = "lavega-facturen";

function byName(wf: Workflow, name: string): Node {
  const found = wf.nodes.filter((n) => n.name === name);
  expect(found, `node "${name}" ontbreekt (of staat er dubbel in)`).toHaveLength(1);
  return found[0];
}

function ofType(wf: Workflow, type: string): Node[] {
  return wf.nodes.filter((n) => n.type === type);
}

/** n8n laat `httpMethod` weg voor zijn default. Die default is GET — dezelfde
 *  aanname als findQueueWebhookNode (n8n-provision.ts:153). */
function methodOf(node: Node): string {
  return String(node.parameters?.httpMethod ?? "GET").toUpperCase();
}

function jsCodeOf(node: Node): string {
  return String(node.parameters?.jsCode ?? "");
}

/** Alle uitgaande edges van een node, over álle uitgangsgroepen platgeslagen —
 *  de false-tak van een If-node is groep 1, niet groep 0, en die was in de
 *  diagnose juist de vergeten tak. */
function edgesFrom(wf: Workflow, name: string): string[] {
  return (wf.connections[name]?.main ?? []).flat().map((e) => e.node);
}

/** Alles wat vanaf `start` bereikbaar is. Zonder `start` zelf: de vraag is altijd
 *  "kan deze node ná die trigger lopen". */
function reach(wf: Workflow, start: string): Set<string> {
  const seen = new Set<string>();
  const todo = [start];
  while (todo.length) {
    for (const target of edgesFrom(wf, todo.pop()!)) {
      if (!seen.has(target)) {
        seen.add(target);
        todo.push(target);
      }
    }
  }
  return seen;
}

/** De leegmaak-node, gevonden op wat hij DOET en niet op zijn naam: een rename
 *  in de n8n-UI mag de wacht hieronder niet omzeilen. */
function drainNode(wf: Workflow): Node {
  const found = wf.nodes.filter((n) => jsCodeOf(n).includes("store.queue = []"));
  // Vindt de locator niets, dan slaagt de bereikbaarheidstest hieronder
  // gratis — dus eerst bewijzen dat hij precies één node vond.
  expect(
    found.map((n) => n.name),
    "geen (of meer dan één) node die `store.queue = []` doet — de locator van de leegmaak-node klopt niet meer",
  ).toHaveLength(1);
  return found[0];
}

const clone = (wf: Workflow): Workflow => JSON.parse(JSON.stringify(wf)) as Workflow;
const edge = (node: string): Edge => ({ node, type: "main", index: 0 });

/* ── de wachten, één per bevinding ─────────────────────────────────────────── */

/** BEVINDING 1 — er was geen intake voor doorgestuurde mail (diagnose :40-63).
 *  Valt dit om: de Cloudflare-worker POST't doorgestuurde facturen naar een pad
 *  dat niemand aanneemt, en elke doorgestuurde mail bounct of verdwijnt. */
function checkMailIntake(wf: Workflow): void {
  const posts = ofType(wf, WEBHOOK).filter((n) => methodOf(n) === "POST");
  expect(
    posts.map((n) => n.name),
    "er is niet precies één POST-webhook voor doorgestuurde mail",
  ).toEqual([MAIL_HOOK]);
  expect(posts[0].parameters?.path).toBe(MAIL_PATH);
  expect(edgesFrom(wf, MAIL_HOOK), `"${MAIL_HOOK}" gaat niet naar "${MAIL_NORM}"`).toEqual([
    MAIL_NORM,
  ]);
  // En hij mondt uit in dezelfde If-node als Gmail: één verwerkingspad, niet twee.
  const branch = ofType(wf, IF);
  expect(branch.map((n) => n.name)).toEqual([IF_NODE]);
  expect(
    edgesFrom(wf, MAIL_NORM),
    "de intake loopt langs de If-node heen en heeft dus zijn eigen, ongeteste pad",
  ).toEqual([IF_NODE]);
  expect(edgesFrom(wf, GMAIL_NORM), "de Gmail-tak loopt langs de If-node heen").toEqual([IF_NODE]);
}

/** BEVINDING 1, de ernstigste helft — de leegmaak-node hoort NIET op het mailpad.
 *
 *  DIT IS DE TEST DIE HET DATAVERLIES TEGENHOUDT. `Geef de rij en leeg hem` zet
 *  `store.queue = []`. Komt die node op het pad van `E-mail binnen` (of van de
 *  uurlijkse tak) te staan, dan LEEGT ELKE DOORGESTUURDE FACTUUR ZIJN HELE
 *  WACHTRIJ: alles wat nog niet opgehaald was is weg, stil, zonder foutmelding,
 *  en de mail die het veroorzaakte krijgt een 200 terug. Leegmaken mag precies
 *  één ding volgen: de GET-webhook die de rij ophaalt, waar de lezer het
 *  antwoord ook echt in handen krijgt. */
function checkDrainOffMailPath(wf: Workflow): void {
  const drain = drainNode(wf).name;
  for (const start of [MAIL_HOOK, HOURLY, MANUAL]) {
    expect(
      [...reach(wf, start)],
      `"${drain}" is bereikbaar vanaf "${start}" — op dat pad leegt elke binnenkomende mail de hele factuurwachtrij`,
    ).not.toContain(drain);
  }
  expect(
    [...reach(wf, QUEUE_HOOK)],
    `"${drain}" hangt niet meer achter "${QUEUE_HOOK}" — dan groeit de rij oneindig en blijft alles onversleuteld in de n8n-database staan`,
  ).toContain(drain);
}

/** BEVINDING 2 — de 404 (diagnose :67-109). Van de vier oorzaken die daar staan
 *  is er precies ÉÉN uit een bestand te lezen: twee webhooks die hetzelfde
 *  (methode, pad) claimen. "Niet geactiveerd", "test-URL" en de queue-mode-
 *  registratie zijn alleen in een levende n8n te zien (diagnose :105-109).
 *  Valt dit om: n8n weigert de workflow te activeren en beide adressen geven
 *  404 — exact de storing waar deze diagnose mee begon. */
function checkNoDuplicateWebhookPath(wf: Workflow): void {
  const claims = ofType(wf, WEBHOOK).map(
    (n) => `${methodOf(n)} ${String(n.parameters?.path ?? "")}`,
  );
  expect(
    new Set(claims).size,
    `twee webhook-nodes claimen hetzelfde adres: ${claims.join(", ")}`,
  ).toBe(claims.length);
}

/** BEVINDING 3 — de Gmail-tak gooide zijn resultaat weg (diagnose :113-126). De
 *  connections hielden daar letterlijk `"Naar LaVega-vorm": { "main": [[]] }`:
 *  een uitgang die verklaard is en nergens heen gaat. Valt dit om: Claude leest
 *  de factuur, de rij blijft leeg, en er staat geen fout in de run — de duurste
 *  vorm van stil verlies die deze workflow heeft. */
function checkGmailBranchLands(wf: Workflow): void {
  expect(
    edgesFrom(wf, TO_LAVEGA),
    `"${TO_LAVEGA}" komt niet uit op "${ENQUEUE}" — Claude leest de factuur en de rij blijft leeg`,
  ).toEqual([ENQUEUE]);
}

/** BEVINDING 3, de vorm van de bug in het algemeen. Geen enkele node mag een
 *  verklaarde-maar-lege uitgangsgroep hebben, elke edge moet op een bestaande
 *  node landen, en niets behalve een trigger mag zonder ingang staan.
 *  Valt dit om: er is een tak die in de n8n-UI verbonden lijkt en in de export
 *  doodloopt — en dat is niet aan de run te zien. */
function checkNoDeadOutput(wf: Workflow): void {
  const names = new Set(wf.nodes.map((n) => n.name));
  for (const [from, out] of Object.entries(wf.connections)) {
    expect(names, `connections noemt "${from}", maar die node bestaat niet`).toContain(from);
    (out.main ?? []).forEach((group, i) => {
      expect(
        group.length,
        `"${from}" uitgang ${i} is verklaard maar leeg — dat is de vorm van bevinding 3`,
      ).toBeGreaterThan(0);
      for (const e of group) {
        // Een typefout in een naam maakt een onzichtbare dode tak: de traversal
        // leest hem als "niet bereikbaar", wat toevallig het antwoord is dat de
        // leegmaak-test graag hoort. Dus hier hard afgekeurd.
        expect(names, `"${from}" wijst naar "${e.node}", en die node bestaat niet`).toContain(
          e.node,
        );
      }
    });
  }
  const targets = new Set(
    Object.values(wf.connections).flatMap((o) => (o.main ?? []).flat().map((e) => e.node)),
  );
  const orphans = wf.nodes
    .filter((n) => !TRIGGERS.includes(n.type) && !targets.has(n.name))
    .map((n) => n.name);
  expect(orphans, "deze nodes hebben geen ingang en kunnen dus nooit lopen").toEqual([]);
}

/** BEVINDING 4 — de ophaalkant stond op POST terwijl LaVega GET doet
 *  (diagnose :130-155). Deze test knoopt het bestand aan de functie die het
 *  consumeert: findQueueWebhookNode kiest de webhook op METHODE, dus een
 *  omgezette methode levert of de mail-in-URL of niets, en dan eindigt
 *  provisioning op "geen webhook-node gevonden" (n8n-provision.ts:376/406).
 *  Valt dit om: "Ophalen uit n8n" in Facturen haalt niets meer op. */
function checkQueueWebhookIsGet(wf: Workflow): void {
  const gets = ofType(wf, WEBHOOK).filter((n) => methodOf(n) === "GET");
  expect(
    gets.map((n) => n.name),
    "er is niet precies één GET-webhook; LaVega haalt met GET op",
  ).toEqual([QUEUE_HOOK]);
  expect(gets[0].parameters?.path).toBe(QUEUE_PATH);
  const found = findQueueWebhookNode(wf);
  expect(found, "findQueueWebhookNode vindt de ophaal-webhook niet meer").not.toBeNull();
  expect(found?.name).toBe(QUEUE_HOOK);
  expect(found?.parameters?.path).toBe(QUEUE_PATH);
}

/** BEVINDING 5 — responseMode en de Respond-node horen bij elkaar
 *  (diagnose :159-184). Twee helften, één test, want geen van beide waarden
 *  betekent iets op zichzelf:
 *  - de GET-kant staat op `responseNode` en heeft de Respond-node achter zich,
 *    anders krijgt de browser de uitvoer van de leegmaak-node in plaats van het
 *    antwoord — of n8n hangt te wachten op een Respond die er niet is;
 *  - de POST-kant staat op `lastNode` en heeft er GEEN achter zich, want anders
 *    krijgt de worker een 200 vóórdat de mail verwerkt is en verdwijnt een mail
 *    die daarna omvalt terwijl de afzender denkt dat hij aankwam. */
function checkResponsePairing(wf: Workflow): void {
  const responders = ofType(wf, RESPOND);
  expect(responders).toHaveLength(1);
  const responder = responders[0].name;

  const queue = byName(wf, QUEUE_HOOK);
  expect(queue.parameters?.responseMode).toBe("responseNode");
  expect(
    [...reach(wf, QUEUE_HOOK)],
    `"${responder}" hangt niet achter de ophaal-webhook`,
  ).toContain(responder);

  const mail = byName(wf, MAIL_HOOK);
  expect(mail.parameters?.responseMode).toBe("lastNode");
  expect(
    [...reach(wf, MAIL_HOOK)],
    `"${responder}" ligt op het mailpad — dan antwoordt n8n de worker vóórdat de mail verwerkt is`,
  ).not.toContain(responder);
}

/** BEVINDING 6 — geen tokencontrole op de ophaal-webhook (diagnose :188-201).
 *  Valt dit om: het adres is een open brievenbus. Op de GET-kant leest iedereen
 *  die de URL kent zijn facturen (bedragen, tegenpartijen, IBAN's) mee; op de
 *  POST-kant zet iedereen die hem raadt regels in zijn wachtrij. */
function checkHeaderAuthOnAllWebhooks(wf: Workflow): void {
  for (const hook of ofType(wf, WEBHOOK)) {
    expect(hook.parameters?.authentication, `webhook "${hook.name}" vraagt geen token`).toBe(
      "headerAuth",
    );
  }
}

/** BEVINDING 6, tweede helft: allowedOrigins hoort ALLEEN op de ophaalkant.
 *  De browser haalt daar op, dus zonder zijn origin in die lijst geeft de fetch
 *  een CORS-fout (checklist stap 8). De worker is geen browser en stuurt geen
 *  Origin, dus een lijst op de POST-kant zou alleen maar suggereren dat daar iets
 *  beschermd wordt (diagnose :320-321). */
function checkAllowedOriginsOnlyOnQueue(wf: Workflow): void {
  const origins = (node: Node) => String(node.parameters?.options?.allowedOrigins ?? "").trim();
  expect(
    origins(byName(wf, QUEUE_HOOK)).length,
    "allowedOrigins is leeg — de browser krijgt dan een CORS-fout bij Ophalen uit n8n",
  ).toBeGreaterThan(0);
  expect(origins(byName(wf, QUEUE_HOOK))).toContain("https://lavega.dev");
  expect(
    origins(byName(wf, MAIL_HOOK)),
    "de intake heeft allowedOrigins gekregen; de worker is geen browser en stuurt geen Origin",
  ).toBe("");
}

/** BEVINDING 7 — de false-tak van `Iets te lezen?` liep dood (diagnose :205-219).
 *  Valt dit om: een mail die Claude niet kan lezen (geen tekst, geen leesbare
 *  bijlage) verdwijnt zonder spoor. Geen regel, geen melding, en niets in de app
 *  dat zegt dat er een factuur is die hij zelf moet ophalen. */
function checkBothIfBranches(wf: Workflow): void {
  const branch = byName(wf, IF_NODE);
  expect(branch.type).toBe(IF);
  const outputs = wf.connections[IF_NODE]?.main ?? [];
  expect(outputs, "de If-node heeft geen twee takken meer").toHaveLength(2);
  expect(outputs[0], "de true-tak is leeg").not.toHaveLength(0);
  expect(outputs[1], "de false-tak is leeg — de onleesbare mail verdwijnt dan").not.toHaveLength(0);
  expect(outputs[0][0].node).toBe(CLAUDE_REQ);
  expect(outputs[1][0].node).toBe(NOTICE);
  // En de melding moet zelf ook aankomen, anders is de tak er wel en het briefje niet.
  expect(
    edgesFrom(wf, NOTICE),
    "de melding komt niet in de wachtrij: de tak bestaat, het briefje niet",
  ).toEqual([ENQUEUE]);
}

/** BEVINDING 8 — de twee remmen op ontdubbelen (diagnose :223-267). De eerste
 *  rem staat vóór Claude en slaat mail over die al gezien is; de tweede staat in
 *  de wachtrij zelf. De intake-node heeft met OPZET geen eerste rem: een mail die
 *  hij handmatig nóg eens doorstuurt hoort opnieuw langs Claude te gaan.
 *  Valt dit om: of hij betaalt elk uur opnieuw voor dezelfde mail (rem 1 weg),
 *  of dezelfde factuur staat twee keer in zijn rij (rem 2 weg). */
function checkDedupBrakes(wf: Workflow): void {
  expect(
    jsCodeOf(byName(wf, GMAIL_NORM)),
    "rem 1 weg: de uurlijkse tak stuurt gezien mail opnieuw naar Claude",
  ).toContain("seen.has(");
  expect(
    jsCodeOf(byName(wf, MAIL_NORM)),
    "de intake-node filtert nu op seenIds — een opnieuw doorgestuurde mail wordt dan stil genegeerd",
  ).not.toContain("seen.has(");
  const enqueue = jsCodeOf(byName(wf, ENQUEUE));
  for (const marker of ["store.seenIds", "store.queue", "messageId"]) {
    expect(enqueue, `rem 2 weg: "${ENQUEUE}" gebruikt ${marker} niet meer`).toContain(marker);
  }
}

/** De leegmaak-node heeft GEEN bronbestand in packages/core/src/n8n en valt dus
 *  buiten de drift-test daar. Dit is zijn enige contract met de consument: de
 *  drie sleutels die apps/web/src/n8n.ts:166 parseQueue verwacht.
 *  Valt dit om: de app krijgt 200 terug en ziet geen enkele factuur. */
function checkDrainContract(wf: Workflow): void {
  const code = jsCodeOf(drainNode(wf));
  expect(code).toContain("$getWorkflowStaticData('global')");
  // Op de RETURN kijken, niet op het hele blok: `invoices` staat ook in de
  // regel die de rij uitleest, dus een omgedoopte uitvoersleutel zou anders
  // ongezien voorbijkomen.
  const returned = code.slice(code.lastIndexOf("return "));
  expect(returned).toContain("json:");
  for (const key of ["invoices", "notices", "servedAt"]) {
    expect(
      returned,
      `de leegmaak-node geeft "${key}" niet meer terug — parseQueue ziet dan geen enkele factuur`,
    ).toContain(key);
  }
  expect(
    parseQueue({ invoices: [], notices: [], servedAt: "2026-08-24T00:00:00.000Z" }),
  ).not.toBeNull();
}

/** Geen geheimen in het bestand. Het gaat als los JSON over de mail en staat in
 *  een publieke repo; een sleutel of token die hier per ongeluk in belandt is
 *  daarmee gelekt. De Anthropic-sleutel mag er alleen als $env-expressie staan
 *  en het factuurtoken hoort een n8n-credential te zijn (diagnose :320-336). */
function checkNoSecrets(raw: string, wf: Workflow): void {
  expect(raw, "er staat een Anthropic-sleutel in het bestand").not.toMatch(
    /sk-ant-[A-Za-z0-9_-]{10,}/,
  );
  expect(raw, "er staat een API-sleutel in het bestand").not.toMatch(/\bsk-[A-Za-z0-9]{20,}\b/);
  // Een credentials-blok bevat de id van een credential uit ZIJN n8n; in een
  // geëxporteerd bestand hoort dat niet te staan, hij hangt ze in stap 3 zelf in.
  expect(wf.nodes.filter((n) => "credentials" in n).map((n) => n.name)).toEqual([]);

  // Sleutelvormige tekst: een aaneengesloten reeks base64-tekens van 40 of
  // langer, gezocht in de string-WAARDEN. Node-uuids bevatten streepjes en
  // vallen dus in korte stukjes uiteen; een losse regex over het hele bestand
  // matcht `"value": "application/json"` en geeft valse alarmen.
  const values: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") values.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(wf);
  const suspicious = values.flatMap((v) =>
    [...v.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)].map((m) => m[0]),
  );
  expect(suspicious, "sleutelvormige tekst in het bestand").toEqual([]);

  const apiKeyHeader = (
    byName(wf, "Lees de factuur").parameters?.headerParameters?.parameters ?? []
  ).find((p: { name?: string }) => p.name === "x-api-key");
  expect(apiKeyHeader?.value).toBe("={{ $env.FT_ANTHROPIC_KEY || $env.ANTHROPIC_API_KEY }}");
}

/* ── de wachten over beide bestanden ───────────────────────────────────────── */

describe.each(FILES)("%s", (rel) => {
  const wf = load(rel);

  test("de naam is de sleutel waarop LaVega zoekt: verandert hij, dan maakt 'Verbind met n8n' een tweede workflow", () => {
    expect(wf.name).toBe(WORKFLOW_NAME);
    // Stap 3 van de checklist noemt deze node bij naam; provisioning rapporteert
    // hem ook. Wijkt de JSON af, dan verwijst het bericht naar iets dat er niet is.
    expect(wf.nodes.map((n) => n.name)).toContain(GMAIL_NODE_NAME);
    expect(wf.settings?.executionOrder).toBe("v1");
  });

  test("bevinding 1 — doorgestuurde mail heeft een intake en komt op het gedeelde pad uit", () => {
    checkMailIntake(wf);
  });

  test("bevinding 1 — leegmaken hangt ALLEEN achter de ophaal-webhook, nooit op het mailpad", () => {
    checkDrainOffMailPath(wf);
  });

  test("bevinding 2 — geen twee webhooks op hetzelfde (methode, pad)", () => {
    checkNoDuplicateWebhookPath(wf);
  });

  test("bevinding 3 — de Gmail-tak komt aan in de wachtrij", () => {
    checkGmailBranchLands(wf);
  });

  test("bevinding 3 — geen lege uitgang, geen edge naar een niet-bestaande node, geen node zonder ingang", () => {
    checkNoDeadOutput(wf);
  });

  test("bevinding 4 — de ophaalkant is GET en findQueueWebhookNode vindt hem", () => {
    checkQueueWebhookIsGet(wf);
  });

  test("bevinding 5 — responseMode en de Respond-node horen bij elkaar, aan beide kanten", () => {
    checkResponsePairing(wf);
  });

  test("bevinding 6 — allowedOrigins staat op de ophaalkant en alleen daar", () => {
    checkAllowedOriginsOnlyOnQueue(wf);
  });

  test("bevinding 7 — beide takken van 'Iets te lezen?' gaan ergens heen", () => {
    checkBothIfBranches(wf);
  });

  test("bevinding 8 — rem 1 staat in de uurlijkse tak, niet in de intake; rem 2 staat in de wachtrij", () => {
    checkDedupBrakes(wf);
  });

  test("de leegmaak-node levert de vorm die parseQueue leest", () => {
    checkDrainContract(wf);
  });

  test("er staat geen sleutel en geen token in het bestand", () => {
    checkNoSecrets(rawText(rel), wf);
  });
});

/* ── bevinding 6: de enige die in de repo nog open staat ───────────────────── */

test("bevinding 6 — beide webhooks eisen een token in de gecorrigeerde export", () => {
  checkHeaderAuthOnAllWebhooks(load(QUEUE_FILE));
});

test("bevinding 6 — de meegeleverde template mist headerAuth op de ophaal-webhook; dat is vastgepind, niet goedgekeurd", () => {
  /* Dit is met opzet geen zwakkere versie van de test hierboven ("headerAuth OF
   * niets" zou de bevinding wegpoetsen), maar een vastlegging van het verschil.
   *
   * WAT HET GEVAL IS. docs/n8n/lavega-invoices.json is de template die de app
   * pusht; daar zet provisioning `authentication: "headerAuth"` alsnog op ELKE
   * webhook (n8n-provision.ts:186, al gedekt door n8n-provision.test.ts:166-178).
   * Voor die weg is het dus gerepareerd. Voor de HANDMATIGE weg niet: n8n biedt
   * alleen een credential-slot op een node die een authentication-modus
   * declareert, dus wie deze template met "Import from File" binnenhaalt heeft bij
   * stap 3 geen veld om `LaVega factuurtoken` aan te hangen — en houdt een
   * ophaal-webhook die zonder token zijn facturen teruggeeft.
   *
   * VALT DEZE TEST OM omdat het veld gevuld is: mooi. Verwijder dan deze test en
   * laat de test hierboven over beide bestanden lopen (FILES in plaats van
   * QUEUE_FILE). */
  const template = load(TEMPLATE_FILE);
  expect(byName(template, MAIL_HOOK).parameters?.authentication).toBe("headerAuth");
  expect(
    byName(template, QUEUE_HOOK).parameters?.authentication,
    "de ophaal-webhook in de template heeft nu wél een authentication-veld — zie de uitleg in deze test",
  ).toBeUndefined();
});

/* ── de twee bestanden mogen niet uit elkaar lopen ──────────────────────────── */

test("de twee exports verschillen in precies vier bekende dingen en nergens anders", () => {
  /* Waarom dit hier staat. De Code-nodes in de template worden in
   * packages/core/src/n8n/codeNodes.test.ts tegen hun bronbestanden gehouden,
   * maar die test leest ALLEEN de template (:10) en scripts/sync-n8n-code.mjs:17
   * heeft datzelfde pad hard ingebakken — `sync:n8n --check` blijft dus groen ook
   * als elke Code-node in de gecorrigeerde export gesloopt is. Deze test sluit
   * die keten: zijn de twee bestanden node-voor-node gelijk, dan geldt de
   * drift-controle van de template ook voor de gecorrigeerde export, inclusief de
   * zevende Code-node (de leegmaak-node) die helemaal geen bronbestand heeft.
   *
   * Voegt iemand een bewust verschil toe, dan valt deze test om en hoort het
   * hieronder met een reden bij te komen staan. Dat is de prijs van twee
   * exports; één artefact zou hem wegnemen. */
  const a = load(QUEUE_FILE);
  const b = load(TEMPLATE_FILE);

  expect(b.nodes.map((n) => n.id)).toEqual(a.nodes.map((n) => n.id));
  expect(JSON.stringify(b.connections)).toBe(JSON.stringify(a.connections));
  expect(JSON.stringify(b.settings)).toBe(JSON.stringify(a.settings));

  const known = new Set<string>();
  for (const node of a.nodes) {
    const twin = byName(b, node.name);
    expect(twin.type).toBe(node.type);
    expect(twin.typeVersion).toBe(node.typeVersion);

    // (1) notes/notesInFlow zijn documentatie in de n8n-UI en staan alleen in de
    //     gecorrigeerde export.
    const strip = (n: Node) => {
      const { notes: _n, notesInFlow: _f, parameters, ...rest } = n;
      return { ...rest, parameters: { ...parameters } } as Node & {
        parameters: Record<string, any>;
      };
    };
    const left = strip(node);
    const right = strip(twin);

    // (2) de Gmail-zoekopdracht: de gecorrigeerde export voegt `OR receipt` toe,
    //     zodat een betaalbewijs ook opgehaald wordt.
    if (left.parameters.filters?.q && right.parameters.filters?.q) {
      expect(String(left.parameters.filters.q).replace(" OR receipt", "")).toBe(
        String(right.parameters.filters.q),
      );
      known.add(node.name + ".filters.q");
      left.parameters.filters = right.parameters.filters;
    }
    // (3) allowedOrigins: de template heeft er twee, de gecorrigeerde export
    //     dezelfde twee plus www en de Railway-host.
    if (node.name === QUEUE_HOOK) {
      const list = (n: Node & { parameters: Record<string, any> }) =>
        String(n.parameters.options?.allowedOrigins ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      for (const origin of list(right)) expect(list(left)).toContain(origin);
      known.add(node.name + ".options.allowedOrigins");
      left.parameters.options = right.parameters.options;
      // (4) authentication: alleen in de gecorrigeerde export gezet. Zie de
      //     vastgepinde test hierboven; verdwijnt dat verschil, dan mag deze
      //     uitzondering weg.
      expect(left.parameters.authentication).toBe("headerAuth");
      expect(right.parameters.authentication).toBeUndefined();
      known.add(node.name + ".authentication");
      delete left.parameters.authentication;
    }

    expect(
      JSON.stringify(right),
      `"${node.name}" loopt uit elkaar buiten de vier bekende verschillen om`,
    ).toBe(JSON.stringify(left));
  }

  expect([...known].sort()).toEqual(
    [
      `${GMAIL_NODE_NAME}.filters.q`,
      `${QUEUE_HOOK}.authentication`,
      `${QUEUE_HOOK}.options.allowedOrigins`,
    ].sort(),
  );
  // De zevende Code-node bestaat en valt hiermee ook onder de vergelijking.
  expect(a.nodes.filter((n) => n.type === CODE)).toHaveLength(7);
});

/* ── de wachten moeten een teruggekeerde regressie ook echt afkeuren ─────────
 *
 * Elke mutatie hieronder gebeurt op een KOPIE in het geheugen. De bestanden op
 * schijf worden alleen gelezen. */

describe("een teruggekeerde bevinding wordt afgekeurd (mutatie in het geheugen)", () => {
  const good = load(QUEUE_FILE);

  test("de goede export komt door alle wachten heen — anders bewijst het omvallen hieronder niets", () => {
    checkMailIntake(good);
    checkDrainOffMailPath(good);
    checkNoDuplicateWebhookPath(good);
    checkGmailBranchLands(good);
    checkNoDeadOutput(good);
    checkQueueWebhookIsGet(good);
    checkResponsePairing(good);
    checkHeaderAuthOnAllWebhooks(good);
    checkAllowedOriginsOnlyOnQueue(good);
    checkBothIfBranches(good);
    checkDedupBrakes(good);
    checkDrainContract(good);
  });

  test("bevinding 4 terug: de ophaal-webhook staat weer op POST", () => {
    const mutant = clone(good);
    byName(mutant, QUEUE_HOOK).parameters!.httpMethod = "POST";
    expect(() => checkQueueWebhookIsGet(mutant)).toThrow();
    // En de functie die de app gebruikt vindt hem dan ook niet meer.
    expect(findQueueWebhookNode(mutant)).toBeNull();
    // Twee POST-webhooks op verschillende paden blijven overigens legaal; het is
    // de methode die de app breekt, niet een dubbele claim.
    expect(() => checkNoDuplicateWebhookPath(mutant)).not.toThrow();
  });

  test("bevinding 1 terug: de leegmaak-node komt op het mailpad te staan", () => {
    const mutant = clone(good);
    const drain = drainNode(mutant).name;
    mutant.connections[ENQUEUE] = { main: [[edge(drain)]] };
    expect(() => checkDrainOffMailPath(mutant)).toThrow();
    // Hier zit het gif in: alle andere wachten blijven groen. Alleen deze ziet het.
    expect(() => checkMailIntake(mutant)).not.toThrow();
    expect(() => checkNoDeadOutput(mutant)).not.toThrow();
    expect(() => checkBothIfBranches(mutant)).not.toThrow();
  });

  test("bevinding 1 terug: leegmaken hangt ook onder de uurlijkse tak", () => {
    const mutant = clone(good);
    mutant.connections[HOURLY] = { main: [[edge(GMAIL_NODE_NAME), edge(drainNode(mutant).name)]] };
    expect(() => checkDrainOffMailPath(mutant)).toThrow();
  });

  test("bevinding 7 terug: de false-tak van 'Iets te lezen?' is weg", () => {
    const mutant = clone(good);
    mutant.connections[IF_NODE] = { main: [[edge(CLAUDE_REQ)]] };
    expect(() => checkBothIfBranches(mutant)).toThrow();
  });

  test("bevinding 7 terug: de false-tak is verklaard maar leeg", () => {
    const mutant = clone(good);
    mutant.connections[IF_NODE] = { main: [[edge(CLAUDE_REQ)], []] };
    expect(() => checkBothIfBranches(mutant)).toThrow();
    expect(() => checkNoDeadOutput(mutant)).toThrow();
  });

  test("bevinding 3 terug: 'Naar LaVega-vorm' houdt `main: [[]]` vast", () => {
    const mutant = clone(good);
    mutant.connections[TO_LAVEGA] = { main: [[]] };
    expect(() => checkGmailBranchLands(mutant)).toThrow();
    expect(() => checkNoDeadOutput(mutant)).toThrow();
  });

  test("bevinding 1 terug: de intake-webhook is verdwenen", () => {
    const mutant = clone(good);
    mutant.nodes = mutant.nodes.filter((n) => n.name !== MAIL_HOOK);
    delete mutant.connections[MAIL_HOOK];
    expect(() => checkMailIntake(mutant)).toThrow();
  });

  test("bevinding 1 terug: de intake loopt langs de If-node heen", () => {
    const mutant = clone(good);
    mutant.connections[MAIL_NORM] = { main: [[edge(CLAUDE_REQ)]] };
    expect(() => checkMailIntake(mutant)).toThrow();
  });

  test("bevinding 2 terug: beide webhooks claimen hetzelfde adres", () => {
    const mutant = clone(good);
    byName(mutant, MAIL_HOOK).parameters!.httpMethod = "GET";
    byName(mutant, MAIL_HOOK).parameters!.path = QUEUE_PATH;
    expect(() => checkNoDuplicateWebhookPath(mutant)).toThrow();
  });

  test("bevinding 5 terug: de ophaalkant staat op lastNode met een Respond-node erachter", () => {
    const mutant = clone(good);
    byName(mutant, QUEUE_HOOK).parameters!.responseMode = "lastNode";
    expect(() => checkResponsePairing(mutant)).toThrow();
  });

  test("bevinding 5 terug: de Respond-node komt op het mailpad", () => {
    const mutant = clone(good);
    mutant.connections[ENQUEUE] = { main: [[edge("Antwoord aan LaVega")]] };
    expect(() => checkResponsePairing(mutant)).toThrow();
  });

  test("bevinding 6 terug: de ophaal-webhook vraagt geen token", () => {
    const mutant = clone(good);
    delete byName(mutant, QUEUE_HOOK).parameters!.authentication;
    expect(() => checkHeaderAuthOnAllWebhooks(mutant)).toThrow();
  });

  test("bevinding 6 terug: allowedOrigins is leeggehaald", () => {
    const mutant = clone(good);
    byName(mutant, QUEUE_HOOK).parameters!.options = {};
    expect(() => checkAllowedOriginsOnlyOnQueue(mutant)).toThrow();
  });

  test("bevinding 8 terug: de intake-node krijgt het seenIds-filter erbij", () => {
    const mutant = clone(good);
    const node = byName(mutant, MAIL_NORM);
    node.parameters!.jsCode = `${jsCodeOf(node)}\nif (seen.has(id)) return [];`;
    expect(() => checkDedupBrakes(mutant)).toThrow();
  });

  test("bevinding 8 terug: de wachtrij houdt geen seenIds meer bij", () => {
    const mutant = clone(good);
    const node = byName(mutant, ENQUEUE);
    node.parameters!.jsCode = jsCodeOf(node).replaceAll("store.seenIds", "store.gezien");
    expect(() => checkDedupBrakes(mutant)).toThrow();
  });

  test("een node zonder ingang wordt gezien", () => {
    const mutant = clone(good);
    mutant.nodes.push({
      id: "b1000000-0000-4000-8000-0000000000ff",
      name: "Losse node",
      type: CODE,
      parameters: {},
    });
    expect(() => checkNoDeadOutput(mutant)).toThrow();
  });

  test("een edge naar een niet-bestaande node wordt gezien, en niet als 'onbereikbaar' weggelezen", () => {
    const mutant = clone(good);
    mutant.connections[TO_LAVEGA] = { main: [[edge("Zet in de wachrij")]] };
    expect(() => checkNoDeadOutput(mutant)).toThrow();
  });

  test("een sleutel in het bestand wordt gezien", () => {
    const mutant = clone(good);
    const key = `sk-ant-api03-${"A1b2C3d4E5f6G7h8".repeat(3)}`;
    byName(mutant, "Lees de factuur").parameters!.headerParameters.parameters[0].value = key;
    expect(() => checkNoSecrets(JSON.stringify(mutant), mutant)).toThrow();
  });

  test("de leegmaak-node kan niet stil van vorm veranderen", () => {
    const mutant = clone(good);
    const node = drainNode(mutant);
    node.parameters!.jsCode = jsCodeOf(node).replace(
      "invoices, notices, servedAt",
      "rows, notices, servedAt",
    );
    expect(() => checkDrainContract(mutant)).toThrow();
  });
});
