import { useState, type ReactNode } from "react";
import {
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setN8nInvoiceToken,
  setN8nInvoiceUrl,
  getInvoiceForwardAddress,
  ensureInvoiceForwardAddress,

  setInvoiceForwardAddress,} from "../settings";

/* Koppelingen — één blok: de webhook-URL en het token van jouw n8n.
 *
 * Hier stonden er drie. Weg zijn "Verbind met n8n" (LaVega zette de workflow, het
 * token en de webhook zelf klaar via de n8n-API) en het doorstuuradres. Beide
 * waren OPZETHULP: eenmalig werk dat je in n8n zelf ook kunt doen, met een
 * CORS-uitleg, een API-sleutel en een provisioning-verslag eromheen die het
 * scherm vulden zonder dat er iets aan te zetten viel. Wat overblijft is het
 * paar dat Facturen élke keer nodig heeft — Facturen leest getN8nInvoiceUrl() en
 * getN8nInvoiceToken() en haalt daarmee de wachtrij op. Dat is de reden dat dit
 * blok blijft en de andere twee niet: zonder dit paar werkt de factuurketen niet.
 *
 * Beide waarden zijn een lokale voorkeur: localStorage, deze browser. Niet in de
 * kluis (een back-up zou dan een levend token bevatten) en nooit naar de
 * LaVega-server. */

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
  const [forwardAddress, setForwardAddress] = useState(getInvoiceForwardAddress());
  const [forwardDraft, setForwardDraft] = useState(getInvoiceForwardAddress());
  const [forwardError, setForwardError] = useState(false);
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
        ? "Opgeslagen in deze browser. Facturen haalt de wachtrij vanzelf op zodra je dat scherm opent."
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
      {/* HET DOORSTUURADRES, TERUG ALS ÉÉN REGEL.
       *
       * Hij vroeg deze kaart weg en dat is gebeurd — de opzethulp, de uitleg en de
       * knoppen zijn er niet meer. Maar dit was de ENIGE plek waar het adres
       * aangemaakt én gelezen werd, en hij test vanavond juist de mailketen. Had hij
       * nog geen adres, dan kon hij er geen meer maken; een opschoning die zijn
       * eigen test onmogelijk maakt is niet wat hij vroeg.
       *
       * Dus: één regel, het adres en een knop die er één maakt als hij er nog geen
       * heeft. Het adres verandert nooit meer nadat het bestaat — een doorstuuradres
       * dat wisselt is een adres waar post naartoe blijft gaan die niemand leest. */}
      <div className="card-header">
        <h2>Doorstuuradres voor facturen</h2>
        <span className="eyebrow">stuur een factuur hiernaartoe en hij komt in de wachtrij</span>
      </div>
      {/* INTYPEN GAAT VOOR GENEREREN. Het adres dat Cloudflare routeert is
          invoices@lavega.dev, niet het lavega-<random>@invoices.lavega.dev dat
          LaVega verzon — ander lokaal deel, ander domein. Een adres dat wij
          bedenken en dat niets routeert is erger dan geen adres: de post komt
          nergens aan terwijl het scherm zegt van wel. Dus typt hij het in, en de
          generator staat ernaast voor wie nog niets heeft. */}
      <label style={{ display: "block", margin: "0 0 var(--sp-3)" }}>
        Adres
        <input
          className="saldo-input"
          value={forwardDraft}
          placeholder="invoices@lavega.dev"
          aria-label="Doorstuuradres"
          onChange={(e) => {
            setForwardDraft(e.target.value);
            setForwardError(false);
          }}
          onBlur={() => {
            if (setInvoiceForwardAddress(forwardDraft)) {
              setForwardAddress(getInvoiceForwardAddress());
              setForwardDraft(getInvoiceForwardAddress());
            } else {
              setForwardError(true);
            }
          }}
        />
      </label>
      {forwardError && (
        <p className="text-warn" role="alert" style={{ margin: "0 0 var(--sp-3)" }}>
          Dat is geen e-mailadres. Niets opgeslagen — het vorige adres staat er nog.
        </p>
      )}
      {!forwardAddress && !forwardError && (
        <p style={{ margin: "0 0 var(--sp-3)" }} className="cell-sub">
          Nog geen adres. Typ het adres dat je in Cloudflare hebt aangemaakt, of{" "}
          <button
            type="button"
            className="btn"
            onClick={() => {
              const made = ensureInvoiceForwardAddress();
              setForwardAddress(made);
              setForwardDraft(made);
            }}
          >
            laat LaVega er een maken
          </button>
          .
        </p>
      )}
      <div className="card-header">
        <h2>Koppeling met n8n</h2>
        <span className="eyebrow">
          voor de facturenwachtrij{" "}
          <InfoEye id="koppeling" what="deze koppeling" open={info === "koppeling"} onToggle={toggle("koppeling")} />
        </span>
      </div>
      <p className="cell-sub">
        Plak hier de <em>Production URL</em> van de webhook-node in jouw n8n en het token dat je daar
        bij <em>Header Auth</em> hebt gezet. Facturen gebruikt die twee om de wachtrij op te halen.
      </p>

      {info === "koppeling" && (
        <InfoNote id="koppeling">
          Je eigen n8n leest je mailbox, laat Claude bepalen of er een factuur in zit, en houdt die vast
          in een wachtrij. LaVega haalt die rij rechtstreeks op:{" "}
          <strong>jouw mailbox → jouw n8n → jouw browser</strong>. De LaVega-server komt er niet aan te
          pas en ziet dus nooit een factuurbedrag.
          <br />
          <br />
          Opzetten doe je één keer, in n8n zelf: importeer <code>docs/n8n/lavega-invoices.json</code>,
          zet een Header Auth-credential op de webhook-node, activeer de workflow, en plak de
          Production URL en dat token hieronder. Beide blijven in deze browser — niet in de kluis, niet
          in een back-up; op een andere computer vul je ze opnieuw in.
          <br />
          <br />
          <strong>Er is met opzet geen testknop.</strong> De webhook leegt de wachtrij zodra hij
          antwoordt: één lezer, één keer — een “test” zou dus echte facturen opgebruiken. Ophalen
          gebeurt in Facturen, waar je elke regel te zien krijgt en zelf bevestigt.
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
