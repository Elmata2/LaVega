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
 * Draai hem NOOIT tegen een echte vault waarin je de geboekte facturen niet kwijt
 * wil: rij 1 boekt zichzelf, dat is het punt. Terugdraaien staat ernaast.
 */
import { createServer } from "node:http";

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
  res.end(JSON.stringify({ invoices: rows, notices: [] }));
  console.log(`200  ${rows.length} rijen geleverd`);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`nepwachtrij op http://127.0.0.1:${PORT}/queue   token: ${TOKEN}`);
  console.log("rij 1 boekt zichzelf · rij 2 gemarkeerd (gespoofte afzender) · rij 3 wacht (incompleet)");
});
