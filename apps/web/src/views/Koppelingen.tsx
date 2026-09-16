import { useEffect, useState, type ReactNode } from "react";
import type { VaultStorage } from "@lavega/adapters";
import { useAppLocale } from "../appLocale.js";
import { adminCopy, type CopySpan } from "../copy/admin.js";
import {
  getN8nSettings,
  setN8nSettings,
  getInvoiceForwardAddress,
  ensureInvoiceForwardAddress,
  setInvoiceForwardAddress,
} from "../settings";

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
 * Beide waarden staan in de versleutelde kluis (net als een broker-credential),
 * niet in localStorage: alleen bereikbaar terwijl de kluis ontgrendeld is, en
 * nooit naar de LaVega-server. Zolang `storage` (nog) niet is doorgegeven staat
 * dit blok uit — zie de prop hieronder. */

/** The eye. Drawn inline: an icon fetched from anywhere would tell that server
 *  the owner opened his bank-integration screen. */
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

type InfoKey = "koppeling" | "url" | "token";

function renderSpans(spans: readonly CopySpan[], keyPrefix = ""): ReactNode[] {
  return spans.map((s, i) => {
    const key = `${keyPrefix}${i}`;
    if (s.mark === "em") return <em key={key}>{s.text}</em>;
    if (s.mark === "strong") return <strong key={key}>{s.text}</strong>;
    if (s.mark === "code") return <code key={key}>{s.text}</code>;
    return s.text;
  });
}

function renderParagraphSpans(paragraphs: readonly (readonly CopySpan[])[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  paragraphs.forEach((spans, i) => {
    if (i > 0) {
      nodes.push(<br key={`br-a-${i}`} />);
      nodes.push(<br key={`br-b-${i}`} />);
    }
    nodes.push(...renderSpans(spans, `p${i}-`));
  });
  return nodes;
}

/** The eye beside a value. A button only — the panel it opens is rendered where
 *  the layout wants it, so a heading never has to contain a paragraph. */
function InfoEye({
  id,
  prefix,
  subject,
  open,
  onToggle,
}: {
  id: InfoKey;
  prefix: string;
  subject: string;
  open: boolean;
  onToggle: () => void;
}) {
  const label = `${prefix} ${subject}`;
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-[24px] h-[24px] p-0! align-middle rounded-[50%]! border border-line bg-surface-2 text-muted! cursor-pointer hover:text-ink! hover:border-accent! aria-expanded:text-ink! aria-expanded:border-accent!"
      aria-label={label}
      title={label}
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
    <p
      className="mt-3! mb-0! py-3 px-4 border border-line border-l-[3px] border-l-accent rounded-sm bg-surface-2 text-muted text-[0.85rem] [&_strong]:text-ink [&_code]:text-ink"
      id={`${id}-uitleg`}
    >
      {children}
    </p>
  );
}

type KoppelingenProps = {
  /** The unlocked vault. URL/token now live there (M4/L6 of the 2026-08-28
   *  review), so until this is wired the n8n block reads/saves nothing rather
   *  than falling back to the plaintext localStorage it replaced. */
  storage?: VaultStorage;
};

export default function Koppelingen({ storage }: KoppelingenProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].koppelingen;
  const [forwardAddress, setForwardAddress] = useState(getInvoiceForwardAddress());
  const [forwardDraft, setForwardDraft] = useState(getInvoiceForwardAddress());
  const [forwardError, setForwardError] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // One open explanation at a time: two panels at once and the fields are
  // buried again, which is the thing this screen was supposed to stop doing.
  const [info, setInfo] = useState<InfoKey | null>(null);
  const toggle = (key: InfoKey) => () => setInfo((cur) => (cur === key ? null : key));

  useEffect(() => {
    if (!storage) return;
    let cancelled = false;
    void getN8nSettings(storage).then(
      (settings) => {
        if (cancelled) return;
        setUrl(settings.invoiceUrl ?? "");
        setToken(settings.invoiceToken ?? "");
      },
      () => {
        if (!cancelled) setNote(c.status.vaultReadFailed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [storage, c.status.vaultReadFailed]);

  const urlLooksWrong = url.trim().length > 0 && !/^https?:\/\//i.test(url.trim());

  async function handleSave() {
    if (!storage) {
      setNote(c.status.notLinkedOnSave);
      return;
    }
    try {
      await setN8nSettings(storage, { invoiceUrl: url, invoiceToken: token });
    } catch {
      setNote(c.status.saveFailed);
      return;
    }
    setNote(url.trim() && token.trim() ? c.status.savedComplete : c.status.savedIncomplete);
  }

  async function handleClear() {
    setUrl("");
    setToken("");
    if (!storage) {
      setNote(c.status.notLinkedOnClear);
      return;
    }
    try {
      await setN8nSettings(storage, { invoiceUrl: "", invoiceToken: "" });
    } catch {
      setNote(c.status.clearFailed);
      return;
    }
    setNote(c.status.cleared);
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
        <h2>{c.forwardAddress.heading}</h2>
        <span className="eyebrow">{c.forwardAddress.eyebrow}</span>
      </div>
      {/* INTYPEN GAAT VOOR GENEREREN, en dit commentaar noemt met opzet GEEN
          concreet adres meer. Het heeft er nu twee genoemd die geen van beide
          klopten: eerst het zelfverzonnen lavega-<random>@invoices.lavega.dev,
          daarna invoices@lavega.dev — terwijl het zijne op 23 augustus
          ale@invoices.lavega.dev bleek te zijn, dat hij zelf draait.

          Dat is het patroon en niet de pech: welk adres routeert bepaalt
          Cloudflare, niet deze code, en elk adres dat wij hier hardop noemen is
          een gok die op een dag onwaar wordt. Een adres dat wij bedenken en dat
          niets routeert is erger dan geen adres — de post komt nergens aan
          terwijl het scherm zegt van wel. Dus typt hij het in, en de generator
          staat ernaast voor wie nog niets heeft. */}
      <label style={{ display: "block", margin: "0 0 var(--sp-3)" }}>
        {c.forwardAddress.addressLabel}
        <input
          className="saldo-input"
          value={forwardDraft}
          placeholder={c.forwardAddress.addressPlaceholder}
          aria-label={c.forwardAddress.addressAriaLabel}
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
          {c.forwardAddress.invalidError}
        </p>
      )}
      {!forwardAddress && !forwardError && (
        <p style={{ margin: "0 0 var(--sp-3)" }} className="cell-sub">
          {c.forwardAddress.emptyIntroPrefix}
          <button
            type="button"
            className="btn"
            onClick={() => {
              const made = ensureInvoiceForwardAddress();
              setForwardAddress(made);
              setForwardDraft(made);
            }}
          >
            {c.forwardAddress.generateButton}
          </button>
          {c.forwardAddress.emptyIntroSuffix}
        </p>
      )}
      <div className="card-header">
        <h2>{c.n8nLink.heading}</h2>
        <span className="eyebrow">
          {c.n8nLink.eyebrow}
          <InfoEye
            id="koppeling"
            prefix={c.n8nLink.explain.prefix}
            subject={c.n8nLink.explain.linkSubject}
            open={info === "koppeling"}
            onToggle={toggle("koppeling")}
          />
        </span>
      </div>
      <p className="cell-sub">{renderSpans(c.n8nLink.intro)}</p>

      {info === "koppeling" && (
        <InfoNote id="koppeling">{renderParagraphSpans(c.n8nLink.info.link)}</InfoNote>
      )}

      <div className="facturen-form">
        <label>
          {c.n8nLink.form.urlLabel}{" "}
          <input
            value={url}
            aria-label={c.n8nLink.form.urlAriaLabel}
            placeholder={c.n8nLink.form.urlPlaceholder}
            style={{ minWidth: "22rem" }}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <InfoEye
          id="url"
          prefix={c.n8nLink.explain.prefix}
          subject={c.n8nLink.explain.urlSubject}
          open={info === "url"}
          onToggle={toggle("url")}
        />{" "}
        <label>
          {c.n8nLink.form.tokenLabel}{" "}
          <input
            value={token}
            type={showToken ? "text" : "password"}
            aria-label={c.n8nLink.form.tokenAriaLabel}
            placeholder={c.n8nLink.form.tokenPlaceholder}
            style={{ minWidth: "16rem" }}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <InfoEye
          id="token"
          prefix={c.n8nLink.explain.prefix}
          subject={c.n8nLink.explain.tokenSubject}
          open={info === "token"}
          onToggle={toggle("token")}
        />{" "}
        <label>
          <input
            type="checkbox"
            checked={showToken}
            aria-label={c.n8nLink.form.showTokenAriaLabel}
            onChange={(e) => setShowToken(e.target.checked)}
          />{" "}
          {c.n8nLink.form.showTokenLabel}
        </label>{" "}
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          {c.n8nLink.form.saveButton}
        </button>{" "}
        <button type="button" className="btn" onClick={handleClear}>
          {c.n8nLink.form.clearButton}
        </button>
      </div>

      {info === "url" && <InfoNote id="url">{renderSpans(c.n8nLink.info.url)}</InfoNote>}
      {info === "token" && <InfoNote id="token">{renderSpans(c.n8nLink.info.token)}</InfoNote>}

      {urlLooksWrong && <p className="cell-sub text-neg">{c.n8nLink.urlWarning}</p>}
      {note && <p className="cell-sub">{note}</p>}
    </section>
  );
}
