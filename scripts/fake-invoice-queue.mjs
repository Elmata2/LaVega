/* EEN NEPWACHTRIJ, om de app-helft van facturen te testen zonder de mailketen.
 *
 * De volledige weg is: mail → Cloudflare Email Worker → n8n → wachtrij → app. Vier
 * schakels, en als er iets niet werkt weet je niet welke. Deze server vervangt
 * alleen de laatste: hij antwoordt op precies dezelfde GET met dezelfde
 * tokenheader, met rijen die de drie gevallen naast elkaar zetten die de
 * auto-boekpoort onderscheidt.
 *
 * Zo test je de poort, de badge, het terugdraaien en het direct koppelen in dertig
 * seconden — en als dit werkt en de echte mail niet, zit het probleem in de keten
 * en niet in de app.
 *
 *   node scripts/fake-invoice-queue.mjs
 *   → Koppelingen: URL http://127.0.0.1:8791/queue, token testtoken
 *
 * JE EIGEN FACTUUR ERDOORHEEN:
 *
 *   node scripts/fake-invoice-queue.mjs --rows mijn-factuur.json
 *
 * Dan vervangen jouw rijen de vier voorbeelden. Waarom een apart bestand en niet
 * dit script aanpassen: een echte factuur bevat de naam van een echte
 * leverancier en een echt bedrag, en die horen niet in een repo thuis. Zet het
 * bestand buiten de repo (bijvoorbeeld in je Downloads) en het blijft van jou.
 *
 * Het formaat is dat van n8n zelf — precies wat de app verwacht, dus wat hier
 * doorheen komt komt straks ook door de echte keten:
 *
 *   [{ "messageId": "eigen-1", "subject": "...", "from": "...",
 *      "senderCheck": "passed", "invoiceNumber": "...",
 *      "issueDate": "2026-08-01", "dueDate": "2026-08-31",
 *      "amountCents": 12100, "vatCents": 2100, "currency": "EUR",
 *      "counterparty": "...", "direction": "expense" }]
 *
 * Laat je een veld weg, dan is het ONBEKEND en niet nul — de app zal die factuur
 * dan laten wachten en zeggen wat er ontbreekt. Dat is precies wat je wilt zien.
 * senderCheck zet je zelf: bij de echte keten komt die van Cloudflare (SPF/DKIM),
 * hier bepaal jij of je een geverifieerde of een verdachte afzender naspeelt.
 *
 * Draai hem NOOIT tegen een echte vault waarin je de geboekte facturen niet kwijt
 * wil: rij 1 boekt zichzelf, dat is het punt. Terugdraaien staat ernaast.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const TOKEN = process.env.FAKE_QUEUE_TOKEN ?? "testtoken";
const PORT = Number(process.env.FAKE_QUEUE_PORT ?? 8791);

/** Vandaag en een vervaldatum die de reconciliatie een kans geeft: een factuur van
 *  vorige week met een betaling die er al kan staan. */
const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

const rows = [
  {
    // 1. BOEKT ZICHZELF: afzender geverifieerd, extractie compleet.
    messageId: "fake-1",
    subject: "Factuur 2026-0207 — meterkast",
    from: "facturen@installatiebedrijf.nl",
    deliveredTo: "alexander-7f3a@invoices.lavega.dev",
    queueKey: "alexander-7f3a",
    senderCheck: "passed",
    senderChecks: { spf: "pass", dkim: "pass", dmarc: "pass" },
    invoiceNumber: "2026-0207",
    issueDate: weekAgo,
    dueDate: today,
    amountCents: 29040,
    vatCents: 5040,
    currency: "EUR",
    counterparty: "Installatiebedrijf Van Dijk B.V.",
    direction: "expense",
  },
  {
    // 2. WACHT OP HEM: de afzender is niet wie hij zegt. Niet weggegooid —
    //    een echte factuur van een domein met een slordige SPF mag niet verdwijnen.
    messageId: "fake-2",
    subject: "URGENT betaling openstaand",
    from: "billing@bank-of-nowhere.example",
    deliveredTo: "alexander-7f3a@invoices.lavega.dev",
    queueKey: "alexander-7f3a",
    senderCheck: "failed",
    senderChecks: { spf: "softfail", dkim: "fail", dmarc: "fail" },
    invoiceNumber: "99999",
    issueDate: today,
    dueDate: today,
    amountCents: 480000,
    vatCents: null,
    currency: "EUR",
    counterparty: "Onbekende Partij",
    direction: "expense",
  },
  {
    // 3. WACHT OP HEM: geverifieerd, maar de extractie mist de vervaldatum en de
    //    valuta. Een lege valuta wordt nooit stilletjes EUR.
    messageId: "fake-3",
    subject: "Uw rekening",
    from: "no-reply@telecom.example",
    deliveredTo: "alexander-7f3a@invoices.lavega.dev",
    queueKey: "alexander-7f3a",
    senderCheck: "passed",
    senderChecks: { spf: "pass", dkim: "none", dmarc: "none" },
    issueDate: today,
    dueDate: null,
    amountCents: 1189,
    vatCents: null,
    currency: "",
    counterparty: "Simyo",
    direction: "expense",
  },
  {
    /* RIJ 4 — het plafond. Alles aan deze rij is in orde: geverifieerde
     * afzender, volledige extractie, btw erbij. Het enige bezwaar is de HOOGTE,
     * en dat is precies het bezwaar dat hij zelf koos: EUR 12.500 boven een
     * grens van EUR 10.000. Zonder deze rij is die grens niet te zien, want
     * elke andere rij valt al eerder af om een andere reden. */
    messageId: "fake-4",
    subject: "Factuur 2026-0211 — verbouwing kantoor",
    from: "administratie@aannemer-terlouw.nl",
    deliveredTo: "alexander-7f3a@invoices.lavega.dev",
    queueKey: "alexander-7f3a",
    senderCheck: "passed",
    senderChecks: { spf: "pass", dkim: "pass", dmarc: "pass" },
    invoiceNumber: "2026-0211",
    issueDate: today,
    // WEL een vervaldatum, en dat is het punt van deze rij: valt hij op een
    // ontbrekend veld, dan komt het plafond niet eens aan de beurt en is het
    // niet te zien. Gemeten: met dueDate null las de rij "vul een vervaldatum
    // in", niet "bedrag te hoog".
    dueDate: today,
    amountCents: 1_250_000,
    vatCents: 216_942,
    currency: "EUR",
    counterparty: "Aannemersbedrijf Terlouw B.V.",
    direction: "expense",
  },
];

/* --rows <bestand>: jouw eigen facturen in plaats van de voorbeelden.
 *
 * Het bestand mag een kale array zijn of {"invoices": [...]} — dat tweede is wat
 * n8n zelf teruggeeft, dus je kunt een echt antwoord uit je workflow er zo in
 * plakken zonder het om te bouwen.
 *
 * Bij een onleesbaar bestand STOPT dit script, en dat is opzet: stil terugvallen
 * op de voorbeeldrijen zou je een geslaagde test laten zien van gegevens die
 * niet van jou zijn. */
const rowsFlag = process.argv.indexOf("--rows");
let serving = rows;
let servingLabel = "de vier voorbeeldrijen";
if (rowsFlag !== -1) {
  const path = process.argv[rowsFlag + 1];
  if (!path) {
    console.error(
      "--rows heeft een pad nodig: node scripts/fake-invoice-queue.mjs --rows mijn-factuur.json",
    );
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`Kan ${path} niet lezen als JSON: ${err.message}`);
    console.error(
      "Er wordt niets geserveerd — anders zou je de voorbeeldrijen testen en denken dat het je eigen factuur was.",
    );
    process.exit(1);
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.invoices;
  if (!Array.isArray(list) || list.length === 0) {
    console.error(
      `${path} bevat geen facturen. Verwacht een array, of {"invoices": [...]} zoals n8n teruggeeft.`,
    );
    process.exit(1);
  }
  serving = list;
  servingLabel = `${list.length} eigen ${list.length === 1 ? "rij" : "rijen"} uit ${path}`;
}

createServer((req, res) => {
  const token = req.headers["x-lavega-token"];
  if (token !== TOKEN) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "verkeerde of ontbrekende x-lavega-token" }));
    console.log(`401  token=${token ?? "(geen)"}`);
    return;
  }
  // Open CORS: dit is een testserver op loopback, en de app draait op een andere
  // poort. De echte n8n heeft hiervoor N8N_DEFAULT_CORS nodig.
  res.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "x-lavega-token, content-type",
  });
  res.end(JSON.stringify({ invoices: serving, notices: [] }));
  console.log(`200  ${serving.length} rijen geleverd`);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`nepwachtrij op http://127.0.0.1:${PORT}/queue   token: ${TOKEN}`);
  console.log(`serveert: ${servingLabel}`);
  /* Alleen de voorbeelden beschrijven als het OOK de voorbeelden zijn. Deze regel
   * zei eerder altijd "rij 1 boekt zichzelf", ook bij je eigen factuur, en dan
   * lees je een uitkomst voor die je niet aan het testen bent. */
  if (serving === rows) {
    console.log(
      "1 boekt zichzelf · 2 gemarkeerd (gespoofte afzender) · 3 wacht (incompleet) · 4 wacht (boven € 10.000)",
    );
  } else {
    console.log(
      "je eigen rijen — ontbrekende velden zijn ONBEKEND, niet nul; de app zegt dan wat er mist",
    );
  }
});
