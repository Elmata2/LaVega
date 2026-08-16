import { useState } from "react";
import {
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setN8nInvoiceToken,
  setN8nInvoiceUrl,
} from "../settings";

/* Koppelingen — where the owner stores the address of his OWN n8n invoice
 * webhook and its token (docs/n8n/FACTUREN.md).
 *
 * Both are local preferences, exactly like the alert buffer and the home
 * country: localStorage, this browser only. Deliberately NOT in the vault —
 * the vault is what a back-up file contains, and a back-up should not carry a
 * live token. And deliberately never sent to the LaVega server: the whole
 * point of the n8n design is that the invoice path is mailbox -> his n8n ->
 * his browser, with our server nowhere in it.
 */

export default function Koppelingen() {
  const [url, setUrl] = useState<string>(() => getN8nInvoiceUrl());
  const [token, setToken] = useState<string>(() => getN8nInvoiceToken());
  const [showToken, setShowToken] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const urlLooksWrong = url.trim().length > 0 && !/^https?:\/\//i.test(url.trim());

  function handleSave() {
    setN8nInvoiceUrl(url);
    setN8nInvoiceToken(token);
    setNote(
      url.trim() && token.trim()
        ? "Opgeslagen in deze browser. Ga naar Facturen en klik op “Ophalen uit n8n”."
        : "Opgeslagen — maar zolang URL óf token leeg is, kan LaVega niets ophalen.",
    );
  }

  function handleClear() {
    setUrl("");
    setToken("");
    setN8nInvoiceUrl("");
    setN8nInvoiceToken("");
    setNote("Gewist. LaVega haalt nu niets meer op uit n8n.");
  }

  return (
    <section className="card" aria-label="Koppelingen">
      <div className="card-header">
        <h2>Koppelingen</h2>
        <span className="eyebrow">n8n · facturen uit je mailbox</span>
      </div>

      <p className="cell-sub">
        Je eigen n8n leest je mailbox, laat Claude bepalen of er een factuur in zit,
        en houdt die vast in een wachtrij. LaVega haalt die rij hier rechtstreeks op:
        <strong> jouw mailbox → jouw n8n → jouw browser</strong>. De LaVega-server komt
        er niet aan te pas en ziet dus nooit een factuurbedrag.
      </p>
      <p className="cell-sub">
        URL en token blijven in deze browser (bij je andere instellingen), niet in de
        kluis en niet in een back-up. Op een andere computer vul je ze opnieuw in.
      </p>

      <div className="facturen-form">
        <label>
          Webhook-URL (n8n, Production URL){" "}
          <input
            value={url}
            aria-label="n8n webhook-URL"
            placeholder="https://jouw-n8n/webhook/lavega-facturen"
            style={{ minWidth: "22rem" }}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>{" "}
        <label>
          Token (header x-lavega-token){" "}
          <input
            value={token}
            type={showToken ? "text" : "password"}
            aria-label="n8n token"
            placeholder="openssl rand -hex 24"
            style={{ minWidth: "16rem" }}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>{" "}
        <label>
          <input
            type="checkbox"
            checked={showToken}
            aria-label="Token tonen"
            onChange={(e) => setShowToken(e.target.checked)}
          />{" "}
          token tonen
        </label>{" "}
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          Opslaan
        </button>{" "}
        <button type="button" className="btn" onClick={handleClear}>
          Wissen
        </button>
      </div>

      {urlLooksWrong && (
        <p className="cell-sub text-neg">
          Dit ziet er niet uit als een webhook-URL — hij hoort met http:// of https:// te
          beginnen.
        </p>
      )}
      {note && <p className="cell-sub">{note}</p>}

      <p className="cell-sub" style={{ marginTop: "var(--sp-3)" }}>
        <strong>Er is met opzet geen testknop.</strong> De webhook leegt de wachtrij
        zodra hij antwoordt: één lezer, één keer. Een “test” zou dus echte facturen
        opgebruiken. Ophalen doe je in Facturen, waar je elke regel te zien krijgt en
        zelf bevestigt.
      </p>
      <p className="cell-sub">
        Werkt ophalen niet? Controleer in n8n of de workflow <em>actief</em> staat (een
        webhook luistert alleen dan), of het token bij <em>Header Auth</em> hetzelfde is,
        en of het adres van deze pagina bij <code>allowedOrigins</code> van de
        webhook-node staat — anders blokkeert de browser het antwoord.
      </p>
    </section>
  );
}
