import { useState, type ReactNode } from "react";
import {
  ensureInvoiceForwardAddress,
  getInvoiceForwardAddress,
  getN8nApiKey,
  getN8nBaseUrl,
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setN8nApiKey,
  setN8nBaseUrl,
  setN8nInvoiceToken,
  setN8nInvoiceUrl,
} from "../settings";
import {
  CORS_ENV_VARS,
  GMAIL_NODE_NAME,
  WORKFLOW_NAME,
  describeProvision,
  provisionN8n,
  type ProvisionOutcome,
} from "../n8n-provision";

/* Koppelingen — drie blokken, van "LaVega doet het" naar "je doet het zelf".
 *
 *   1. Verbind met n8n   — LaVega zet de workflow, het token en de webhook zelf
 *                          klaar via de n8n-API. Één stap blijft handwerk: het
 *                          Gmail-credential.
 *   2. Doorstuuradres    — het adres van deze kluis. Wat je ernaartoe stuurt
 *                          komt in de wachtrij; meer doet het niet, en dat staat
 *                          er ook.
 *   3. Handmatig         — de oude weg: webhook-URL en token plakken. Blijft
 *                          bestaan, want die heeft niets van je n8n nodig.
 *
 * ALLES hier is een lokale voorkeur: localStorage, deze browser. Niet in de
 * kluis (een back-up zou dan een levend token bevatten) en nooit naar de
 * LaVega-server. Dat geldt dubbel voor de n8n API-sleutel: die kan workflows
 * aanmaken en wijzigen. Daarom belt de browser rechtstreeks met jouw n8n en
 * staat er met opzet geen proxy op onze server tussen — dat zou die sleutel op
 * een gedeelde host parkeren. De prijs daarvan is CORS; zie het oog hiernaast. */

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

type InfoKey = "koppeling" | "url" | "token" | "cors" | "apikey" | "adres";

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

type KoppelingenProps = {
  /** Injectable for tests; production uses the browser's own fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; production reads the page's real origin, which has to
   *  end up in the webhook's allowedOrigins or the queue fetch is blocked. */
  origin?: string;
};

export default function Koppelingen({ fetchImpl, origin }: KoppelingenProps = {}) {
  const [url, setUrl] = useState<string>(() => getN8nInvoiceUrl());
  const [token, setToken] = useState<string>(() => getN8nInvoiceToken());
  const [showToken, setShowToken] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // One open explanation at a time: two panels at once and the fields are
  // buried again, which is the thing this screen was supposed to stop doing.
  const [info, setInfo] = useState<InfoKey | null>(null);
  const toggle = (key: InfoKey) => () => setInfo((cur) => (cur === key ? null : key));

  // --- blok 1: LaVega richt n8n zelf in
  const [baseUrl, setBaseUrl] = useState<string>(() => getN8nBaseUrl());
  const [apiKey, setApiKey] = useState<string>(() => getN8nApiKey());
  const [showApiKey, setShowApiKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [provisionNote, setProvisionNote] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<ProvisionOutcome | null>(null);

  // --- blok 2: het doorstuuradres. Alleen LEZEN bij het openen: een adres dat
  // vanzelf ontstaat op een scherm dat je even bekijkt, is een adres dat je niet
  // gevraagd hebt. Hij maakt hem met de knop.
  const [address, setAddress] = useState<string>(() => getInvoiceForwardAddress());
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const urlLooksWrong = url.trim().length > 0 && !/^https?:\/\//i.test(url.trim());

  async function handleConnect() {
    setConnecting(true);
    setProvisionNote("Bezig met verbinden met n8n…");
    setProvisioned(null);
    try {
      // Bewaar wat hij intypte vóór de aanroep: mislukt het op CORS, dan hoeft
      // hij het na het zetten van die twee variabelen niet opnieuw te plakken.
      setN8nBaseUrl(baseUrl);
      setN8nApiKey(apiKey);
      const outcome = await provisionN8n({
        baseUrl,
        apiKey,
        origin: origin ?? (typeof window === "undefined" ? "" : window.location.origin),
        fetchImpl,
      });
      setProvisioned(outcome);
      setProvisionNote(describeProvision(outcome));
      if (outcome.kind === "ok") {
        // Pas hier komen webhook-URL en token in de opslag: ze bestaan alleen
        // als n8n ze echt heeft geaccepteerd.
        setN8nInvoiceUrl(outcome.webhookUrl);
        setN8nInvoiceToken(outcome.token);
        setUrl(outcome.webhookUrl);
        setToken(outcome.token);
      }
    } finally {
      setConnecting(false);
    }
  }

  function handleMakeAddress() {
    const next = ensureInvoiceForwardAddress();
    setAddress(next);
    setCopyNote(null);
  }

  async function handleCopyAddress() {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip || typeof clip.writeText !== "function") {
      // Zeg wát er mist in plaats van "kopiëren mislukt": op http:// zonder
      // localhost geeft de browser geen clipboard, en dan is selecteren de weg.
      setCopyNote("Deze browser geeft de pagina geen toegang tot het klembord (dat kan alleen op https). Selecteer het adres hierboven en kopieer het zelf.");
      return;
    }
    try {
      await clip.writeText(address);
      setCopyNote("Adres gekopieerd.");
    } catch {
      setCopyNote("De browser weigerde het klembord. Selecteer het adres hierboven en kopieer het zelf.");
    }
  }

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
    <>
      {/* ── 1 · LaVega richt n8n in ─────────────────────────────────────── */}
      <section className="card" aria-label="Verbinden met n8n">
        <div className="card-header">
          <h2>Verbind met n8n</h2>
          <span className="eyebrow">
            LaVega zet de workflow zelf klaar{" "}
            <InfoEye id="koppeling" what="deze koppeling" open={info === "koppeling"} onToggle={toggle("koppeling")} />
          </span>
        </div>

        {info === "koppeling" && (
          <InfoNote id="koppeling">
            Je eigen n8n leest je mailbox, laat Claude bepalen of er een factuur in zit, en houdt die vast
            in een wachtrij. LaVega haalt die rij rechtstreeks op:{" "}
            <strong>jouw mailbox → jouw n8n → jouw browser</strong>. De LaVega-server komt er niet aan te
            pas en ziet dus nooit een factuurbedrag.
            <br />
            <br />
            Met de knop hieronder doet LaVega in jouw n8n vier dingen: de workflow{" "}
            <em>{WORKFLOW_NAME}</em> opzoeken of aanmaken, een token verzinnen en daar een{" "}
            <em>Header Auth</em>-credential van maken, de workflow activeren, en de webhook-URL
            teruglezen. Adres en sleutel blijven in deze browser, niet in de kluis en niet in een
            back-up; op een andere computer vul je ze opnieuw in.
            <br />
            <br />
            <strong>Er is met opzet geen testknop.</strong> De webhook leegt de wachtrij zodra hij
            antwoordt: één lezer, één keer — een “test” zou dus echte facturen opgebruiken. Ophalen
            gebeurt in Facturen, waar je elke regel te zien krijgt en zelf bevestigt.
          </InfoNote>
        )}

        <div className="facturen-form">
          <label>
            n8n-adres{" "}
            <input
              value={baseUrl}
              aria-label="n8n basis-URL"
              placeholder="https://n8n.jouwdomein.nl"
              style={{ minWidth: "18rem" }}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>{" "}
          <label>
            n8n API-sleutel{" "}
            <input
              value={apiKey}
              type={showApiKey ? "text" : "password"}
              aria-label="n8n API-sleutel"
              placeholder="Settings → n8n API → Create an API key"
              style={{ minWidth: "18rem" }}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <InfoEye id="apikey" what="de n8n API-sleutel" open={info === "apikey"} onToggle={toggle("apikey")} />{" "}
          <label>
            <input
              type="checkbox"
              checked={showApiKey}
              aria-label="API-sleutel tonen"
              onChange={(e) => setShowApiKey(e.target.checked)}
            />{" "}
            sleutel tonen
          </label>{" "}
          <button type="button" className="btn btn-primary" disabled={connecting} onClick={() => void handleConnect()}>
            Verbind met n8n
          </button>
          <InfoEye id="cors" what="CORS in n8n" open={info === "cors"} onToggle={toggle("cors")} />
        </div>

        {info === "apikey" && (
          <InfoNote id="apikey">
            Maak hem in n8n onder <em>Settings → n8n API → Create an API key</em>. Hij mag workflows
            aanmaken en wijzigen, dus behandel hem als een wachtwoord. Hij blijft in deze browser en
            gaat <strong>nooit</strong> naar de LaVega-server: een proxy op onze server zou CORS
            omzeilen, maar zou die sleutel op een gedeelde host parkeren — een slechtere ruil dan het
            plakwerk dat dit vervangt.
          </InfoNote>
        )}
        {info === "cors" && (
          <InfoNote id="cors">
            <strong>Zet dit eerst, anders lukt verbinden niet.</strong> De REST-API van n8n stuurt
            standaard geen CORS-headers, en dan blokkeert je browser het antwoord vóórdat LaVega het
            ziet. Zet op je eigen n8n deze twee omgevingsvariabelen en herstart n8n:
            <br />
            <code>{CORS_ENV_VARS[0]}</code>
            <br />
            <code>{CORS_ENV_VARS[1]}</code>
            <br />
            Draait deze pagina op een ander adres, zet dat adres er dan bij — het staat in de balk van
            je browser. Werkt het daarna nog niet, dan kun je altijd nog blok 3 hieronder gebruiken:
            dat plakwerk heeft niets van je n8n nodig.
          </InfoNote>
        )}

        {provisionNote && (
          <p className={`cell-sub${provisioned && provisioned.kind !== "ok" ? " text-neg" : ""}`}>{provisionNote}</p>
        )}

        {provisioned?.kind === "ok" && (
          <p className="cell-sub text-warn">
            <strong>Nog één stap, en die kan alleen jij doen.</strong> Open in n8n de workflow{" "}
            <em>{WORKFLOW_NAME}</em>, klik op de node <strong>“{GMAIL_NODE_NAME}”</strong> en kies daar
            je Gmail-credential. Google's toestemming is een klik van jou, en de n8n-API kan bestaande
            credentials niet opzoeken — daarom is dit de enige stap die handwerk blijft. Eén keer, en
            daarna nooit meer.
          </p>
        )}
        {provisioned?.kind === "ok" && (
          <p className="cell-sub">
            Het token staat hieronder bij <em>Handmatig instellen</em> — zet “token tonen” aan als je
            hem nodig hebt. Beide webhooks van de workflow gebruiken hetzelfde token: deze browser
            stuurt hem mee bij het ophalen, en het doorstuuradres stuurt hem mee bij het afleveren.
            Elke keer dat je opnieuw verbindt maakt LaVega een <em>nieuw</em> token en een nieuw
            credential. Het oude blijft in n8n staan en doet niets meer; je kunt het daar weghalen.
          </p>
        )}
      </section>

      {/* ── 2 · Het doorstuuradres ──────────────────────────────────────── */}
      <section className="card" aria-label="Doorstuuradres voor facturen">
        <div className="card-header">
          <h2>Doorstuuradres</h2>
          <span className="eyebrow">
            stuur een factuur door{" "}
            <InfoEye id="adres" what="het doorstuuradres" open={info === "adres"} onToggle={toggle("adres")} />
          </span>
        </div>

        {address ? (
          <div className="facturen-form">
            <code data-testid="forward-address">{address}</code>{" "}
            <button type="button" className="btn" onClick={() => void handleCopyAddress()}>
              Kopieer adres
            </button>
          </div>
        ) : (
          <div className="stack-form-actions">
            <button type="button" className="btn btn-primary" onClick={handleMakeAddress}>
              Maak mijn doorstuuradres
            </button>
          </div>
        )}
        {copyNote && <p className="cell-sub">{copyNote}</p>}

        <p className="cell-sub">
          <strong>Zo gebruik je hem.</strong> Stuur een factuurmail door naar dit adres — of zet in
          Gmail één filter dat mail met een factuur automatisch doorstuurt (
          <em>Instellingen → Filters → Nieuw filter → Doorsturen naar</em>). Wat binnenkomt gaat langs
          dezelfde weg als de rest: jouw n8n leest hem, en jij bevestigt elke regel in Facturen.
        </p>
        <p className="cell-sub text-warn">
          <strong>Wat dit adres niet doet.</strong> Het leest geen mailbox — alleen wat er
          naartoe gestuurd wordt, komt binnen. Het gaat niet terug in de tijd: een filter vangt
          nieuwe mail, oude facturen moet je met de hand doorsturen. En het adres is niet geheim
          maar wel onraadbaar; wie het kent kan er post in leggen, en die post wordt nooit
          geboekt zonder dat jij het bevestigt.
        </p>

        {info === "adres" && (
          <InfoNote id="adres">
            Dit adres hoort bij deze kluis en wordt één keer gemaakt. Het willekeurige stuk is de
            beveiliging: een adres dat niemand kan raden, krijgt geen post van iemand die het niet
            van jou heeft. Er hoeft verder niets voor ingesteld te worden — het hele domein wordt
            doorgestuurd, en het stuk vóór de @ zegt van wie de wachtrij is.
          </InfoNote>
        )}
      </section>

      {/* ── 3 · Handmatig, de weg die niets van je n8n nodig heeft ──────── */}
      <section className="card" aria-label="Koppelingen">
        <div className="card-header">
          <h2>Handmatig instellen</h2>
          <span className="eyebrow">terugval — werkt altijd</span>
        </div>
        <p className="cell-sub">
          Lukt “Verbind met n8n” niet, dan doe je het zoals eerst: importeer{" "}
          <code>docs/n8n/lavega-invoices.json</code> in n8n, zet zelf een Header Auth-credential op de
          webhook-node, activeer de workflow, en plak de Production URL en dat token hieronder. Deze
          weg heeft niets van de n8n-API nodig en werkt dus ook als CORS dwarsligt.
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
    </>
  );
}
