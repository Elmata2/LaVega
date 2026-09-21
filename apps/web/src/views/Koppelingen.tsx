import { useEffect, useRef, useState } from "react";
import { useAppLocale } from "../appLocale.js";
import { adminCopy } from "../copy/admin.js";
import {
  getInvoiceForwardAddress,
  ensureInvoiceForwardAddress,
  setInvoiceForwardAddress,
  SUGGESTED_INVOICE_FORWARD_ADDRESS,
} from "../settings";
import { fetchForwardAddress, recordForwardAddress } from "../n8n.js";
import Button from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";

/* Koppelingen — één blok: het doorstuuradres voor facturen.
 *
 * Hier stond ook het n8n-webhook-paar (URL + token). Dat is weg: de server
 * bewaart nu zelf welk n8n hij aanroept, en dit scherm hoeft dat paar niet
 * meer te tonen of op te slaan. Wat overblijft is het doorstuuradres — de
 * LOKALE kant (typen, suggestie, genereren, kopiëren, in localStorage) en de
 * SERVER-kant eronder: wat `/api/n8n/forward-address` daadwerkelijk heeft
 * opgeslagen, en de knop die dat expliciet, met een tussenstap, zet. */

type KoppelingenProps = {
  fetchImpl?: typeof fetch;
};

export default function Koppelingen({ fetchImpl }: KoppelingenProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].koppelingen;
  const [forwardAddress, setForwardAddress] = useState(getInvoiceForwardAddress());
  const [forwardDraft, setForwardDraft] = useState(getInvoiceForwardAddress());
  const [forwardError, setForwardError] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const [serverState, setServerState] = useState<"loading" | "ok" | "error">("loading");
  const [serverLocalPart, setServerLocalPart] = useState<string | null>(null);
  const [confirmRecord, setConfirmRecord] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordNote, setRecordNote] = useState<string | null>(null);

  /* READ ONLY. Deze effect POST't nooit — het schrijft alleen naar de server
   * op een expliciete klik door `doRecord`, nooit hierdoor, ongeacht wat
   * localStorage op dat moment bevat. */
  useEffect(() => {
    let cancelled = false;
    void fetchForwardAddress(fetchImpl).then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "ok") {
        setServerLocalPart(outcome.localPart);
        setServerState("ok");
      } else {
        setServerState("error");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUseSuggestedAddress() {
    setInvoiceForwardAddress(SUGGESTED_INVOICE_FORWARD_ADDRESS);
    const now = getInvoiceForwardAddress();
    setForwardAddress(now);
    setForwardDraft(now);
  }

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(forwardAddress);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard permission denied, or unavailable (older browser, insecure
       * context) — the address is still plain text in the field, selectable
       * by hand. Nothing to recover from, so nothing to show. */
    }
  }

  /* The server stores only the LOCAL PART (migration 0008) — never a domain.
   * `INVOICE_FORWARD_DOMAIN` is this app's own assumed default, not a fact
   * about what any given user actually typed; `settings.ts`'s FORWARD_PATTERN
   * deliberately accepts any domain Cloudflare might route (see its own
   * commentary). So a recorded local part is only safe to show as a full
   * address when it matches the CURRENT local draft — the one place we still
   * know the real domain the user confirmed. When it doesn't match (a
   * different browser, or a draft typed after recording), showing a
   * fabricated "@invoices.lavega.dev" would assert a domain nobody confirmed;
   * the bare local part is the honest thing to show instead. */
  function displayAddress(localPart: string): string {
    const draftLocalPart = forwardAddress.includes("@") ? forwardAddress.split("@")[0] : "";
    return draftLocalPart === localPart ? forwardAddress : localPart;
  }

  async function doRecord() {
    setRecording(true);
    setRecordNote(null);
    const localPart = forwardAddress.split("@")[0];
    const outcome = await recordForwardAddress(localPart, fetchImpl);
    setRecording(false);
    setConfirmRecord(false);
    if (outcome.kind === "stored") {
      setServerLocalPart(outcome.localPart);
      setRecordNote(c.forwardAddress.server.recorded(displayAddress(outcome.localPart)));
      return;
    }
    if (outcome.kind === "taken") return setRecordNote(c.forwardAddress.server.taken);
    if (outcome.kind === "invalid") return setRecordNote(c.forwardAddress.server.invalid);
    if (outcome.kind === "unauthorized") return setRecordNote(c.forwardAddress.server.unauthorized);
    setRecordNote(c.forwardAddress.server.recordFailed);
  }

  return (
    <Card as="section" aria-label={c.ariaLabel}>
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
      <CardHeader>
        <h2>{c.forwardAddress.heading}</h2>
        <span className="eyebrow">{c.forwardAddress.eyebrow}</span>
      </CardHeader>
      {/* INTYPEN GAAT VOOR GENEREREN, en dit commentaar noemt met opzet GEEN
          concreet adres meer. Het heeft er nu twee genoemd die geen van beide
          klopten: eerst het zelfverzonnen lavega-<random>@invoices.lavega.dev,
          daarna invoices@lavega.dev — terwijl het zijne op 23 augustus
          ale@invoices.lavega.dev bleek te zijn, dat hij zelf draait.

          Dat is het patroon en niet de pech: welk adres routeert bepaalt
          Cloudflare, niet deze code, en elk adres dat wij hier hardop noemen is
          een gok die op een dag onwaar wordt. Een adres dat wij bedenken en dat
          niets routeert is erger dan geen adres — de post komt nergens aan
          terwijl het scherm zegt van wel. Dus typt hij het in, en de lege staat
          hieronder biedt twee kant-en-klare opties naast elkaar, ieder met zijn
          eigen afweging erbij — geen van beide is de "winnaar".

          Het invoerveld is met opzet een gewone brede tekstregel en niet
          SaldoInput: dat onderdeel is rechts uitgelijnd en 120px breed, gemaakt
          voor een banksaldo, en een e-mailadres in dat vakje moet je met de
          cursor heen en weer scrollen om te lezen. */}
      <label htmlFor="forward-address" style={{ display: "block", margin: "0 0 var(--sp-1)" }}>
        {c.forwardAddress.addressLabel}
      </label>
      <div
        className="flex gap-2"
        style={{ margin: "0 0 var(--sp-3)", maxWidth: "28rem" }}
      >
        <input
          id="forward-address"
          className="w-full"
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
        {forwardAddress && (
          <Button
            type="button"
            onClick={() => void handleCopyAddress()}
            aria-label={c.forwardAddress.copyButtonAriaLabel}
          >
            {copied ? c.forwardAddress.copiedLabel : c.forwardAddress.copyButton}
          </Button>
        )}
      </div>
      {forwardError && (
        <p className="text-warn" role="alert" style={{ margin: "0 0 var(--sp-3)" }}>
          {c.forwardAddress.invalidError}
        </p>
      )}
      {!forwardAddress && !forwardError && (
        <div style={{ margin: "0 0 var(--sp-3)" }}>
          <p className="cell-sub">{c.forwardAddress.emptyIntro}</p>
          <div className="flex flex-wrap gap-4">
            <div>
              <Button onClick={handleUseSuggestedAddress}>
                {c.forwardAddress.suggestedButton(SUGGESTED_INVOICE_FORWARD_ADDRESS)}
              </Button>
              <p className="cell-sub text-muted text-[0.85rem]" style={{ margin: "var(--sp-1) 0 0" }}>
                {c.forwardAddress.suggestedTradeoff}
              </p>
            </div>
            <div>
              <Button
                onClick={() => {
                  const made = ensureInvoiceForwardAddress();
                  setForwardAddress(made);
                  setForwardDraft(made);
                }}
              >
                {c.forwardAddress.generateButton}
              </Button>
              <p className="cell-sub text-muted text-[0.85rem]" style={{ margin: "var(--sp-1) 0 0" }}>
                {c.forwardAddress.generateTradeoff}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* HET SERVER-ADRES, ERONDER. Dit blok leest wat de server daadwerkelijk
       * gebruikt om de wachtrij mee op te halen — dat kan afwijken van het
       * lokale concept hierboven totdat hij expliciet op "Gebruik dit adres"
       * klikt en dat bevestigt. Zie doRecord: alleen die klik schrijft. */}
      {serverState === "loading" && <p className="cell-sub">{c.forwardAddress.server.loading}</p>}
      {serverState === "error" && (
        <p className="cell-sub text-neg">{c.forwardAddress.server.readFailed}</p>
      )}
      {serverState === "ok" && (
        <p className="cell-sub">
          {serverLocalPart
            ? c.forwardAddress.server.active(displayAddress(serverLocalPart))
            : c.forwardAddress.server.none}
        </p>
      )}
      {forwardAddress && !confirmRecord && (
        <p>
          <Button onClick={() => setConfirmRecord(true)}>{c.forwardAddress.server.recordButton}</Button>
        </p>
      )}
      {forwardAddress && confirmRecord && (
        <>
          <p role="alert" className="text-warn">
            {c.forwardAddress.server.confirmWarning(forwardAddress)}
          </p>
          <p>
            <Button variant="primary" disabled={recording} onClick={() => void doRecord()}>
              {recording ? c.forwardAddress.server.recording : c.forwardAddress.server.confirmButton}
            </Button>{" "}
            <Button disabled={recording} onClick={() => setConfirmRecord(false)}>
              {c.forwardAddress.server.cancelButton}
            </Button>
          </p>
        </>
      )}
      {recordNote && <p className="cell-sub">{recordNote}</p>}
    </Card>
  );
}
