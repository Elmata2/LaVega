import { useState, type ReactNode } from "react";
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
 *
 * The screen used to explain all of that in five paragraphs above two input
 * boxes, so the thing you came here to do was the smallest thing on the page.
 * Every explanation now sits behind an eye next to the value it explains: one
 * click when you need to know what a value IS, out of the way the rest of the
 * time. Nothing was deleted — it moved. */

/** The eye. Drawn inline: an icon fetched from anywhere would tell that server
 *  the owner opened his bank-integration screen. */
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

type InfoKey = "koppeling" | "url" | "token";

/** The eye beside a value. A button only — the panel it opens is rendered where
 *  the layout wants it, so a heading never has to contain a paragraph. */
function InfoEye({ id, what, open, onToggle }: { id: InfoKey; what: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="field-info"
      aria-label={`Uitleg bij ${what}`}
      title={`Uitleg bij ${what}`}
      aria-expanded={open}
      aria-controls={`${id}-uitleg`}
      onClick={onToggle}
    >
      <EyeIcon />
    </button>
  );
}

function InfoNote({ id, children }: { id: InfoKey; children: ReactNode }) {
  return (
    <p className="field-note" id={`${id}-uitleg`}>
      {children}
    </p>
  );
}

export default function Koppelingen() {
  const [url, setUrl] = useState<string>(() => getN8nInvoiceUrl());
  const [token, setToken] = useState<string>(() => getN8nInvoiceToken());
  const [showToken, setShowToken] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // One open explanation at a time: two panels at once and the fields are
  // buried again, which is the thing this screen was supposed to stop doing.
  const [info, setInfo] = useState<InfoKey | null>(null);
  const toggle = (key: InfoKey) => () => setInfo((cur) => (cur === key ? null : key));

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
        <span className="eyebrow">
          n8n · facturen uit je mailbox{" "}
          <InfoEye id="koppeling" what="deze koppeling" open={info === "koppeling"} onToggle={toggle("koppeling")} />
        </span>
      </div>

      {info === "koppeling" && (
        <InfoNote id="koppeling">
          Je eigen n8n leest je mailbox, laat Claude bepalen of er een factuur in zit, en houdt die vast
          in een wachtrij. LaVega haalt die rij hier rechtstreeks op:{" "}
          <strong>jouw mailbox → jouw n8n → jouw browser</strong>. De LaVega-server komt er niet aan te
          pas en ziet dus nooit een factuurbedrag. URL en token blijven in deze browser, niet in de kluis
          en niet in een back-up; op een andere computer vul je ze opnieuw in.
          <br />
          <br />
          <strong>Er is met opzet geen testknop.</strong> De webhook leegt de wachtrij zodra hij
          antwoordt: één lezer, één keer — een “test” zou dus echte facturen opgebruiken. Ophalen doe je
          in Facturen, waar je elke regel te zien krijgt en zelf bevestigt.
          <br />
          <br />
          Werkt ophalen niet? Controleer in n8n of de workflow <em>actief</em> staat (een webhook
          luistert alleen dan), of het token bij <em>Header Auth</em> hetzelfde is, en of het adres van
          deze pagina bij <code>allowedOrigins</code> van de webhook-node staat — anders blokkeert de
          browser het antwoord.
        </InfoNote>
      )}

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
        </label>
        <InfoEye id="url" what="de webhook-URL" open={info === "url"} onToggle={toggle("url")} />{" "}
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
        </label>
        <InfoEye id="token" what="het token" open={info === "token"} onToggle={toggle("token")} />{" "}
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

      {info === "url" && (
        <InfoNote id="url">
          Het adres waarop jouw n8n luistert. In n8n staat hij op de Webhook-node onder{" "}
          <em>Production URL</em> — niet de Test URL, die werkt alleen zolang je in n8n op “Listen” hebt
          geklikt. Hij begint met http:// of https://.
        </InfoNote>
      )}
      {info === "token" && (
        <InfoNote id="token">
          Een wachtwoord dat je zelf verzint, zodat alleen jouw browser die wachtrij mag leegmaken. Maak
          er een met <code>openssl rand -hex 24</code> en zet dezelfde waarde in n8n bij{" "}
          <em>Header Auth</em>, headernaam <code>x-lavega-token</code>. Hij blijft in deze browser en
          gaat nooit naar de LaVega-server.
        </InfoNote>
      )}

      {urlLooksWrong && (
        <p className="cell-sub text-neg">
          Dit ziet er niet uit als een webhook-URL — hij hoort met http:// of https:// te
          beginnen.
        </p>
      )}
      {note && <p className="cell-sub">{note}</p>}
    </section>
  );
}
