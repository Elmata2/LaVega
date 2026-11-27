import { useEffect, useReducer, useRef, useState } from "react";
import { useAppLocale } from "../appLocale.js";
import { adminCopy } from "../copy/admin.js";
import {
  getInvoiceForwardAddress,
  generateInvoiceForwardAddress,
  INVOICE_FORWARD_DOMAIN,
  setInvoiceForwardAddress,
} from "../settings";
import type { View } from "../App";
import { fetchForwardAddress, recordForwardAddress } from "../n8n.js";
import posthog from "../posthog.js";
import { FORWARDING_GUIDE_ANCHOR } from "./ForwardingGuide.js";
import Button from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";
import StatusLine from "../components/ui/StatusLine.js";

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
  onNavigate?: (view: View) => void;
};

type ServerStatus =
  | { status: "loading"; attempt: number }
  | { status: "ok"; localPart: string | null }
  | { status: "error" };

type RecordStatus =
  | { status: "idle"; note: string | null }
  | { status: "confirming"; address: string }
  | { status: "recording"; address: string };

type CreateStatus =
  | { status: "idle"; info: string | null }
  | { status: "creating" }
  | { status: "taken" }
  | { status: "failed"; note: string };

type KoppelingenState = {
  forwardAddress: string;
  forwardDraft: string;
  forwardError: boolean;
  showOwn: boolean;
  server: ServerStatus;
  record: RecordStatus;
  create: CreateStatus;
};

type KoppelingenAction =
  | { type: "draft-change"; value: string }
  | { type: "draft-commit"; address: string }
  | { type: "draft-invalid" }
  | { type: "show-own" }
  | { type: "read-retry" }
  | { type: "server-ok"; localPart: string | null }
  | { type: "server-error" }
  | { type: "adopt"; serverPart: string; localAddress: string | null; info?: string | null }
  | { type: "create-start" }
  | { type: "create-taken" }
  | { type: "create-failed"; note: string }
  | { type: "record-confirm"; address: string }
  | { type: "record-cancel" }
  | { type: "record-start"; address: string }
  | { type: "record-done"; note: string; storedLocalPart?: string };

function koppelingenReducer(state: KoppelingenState, action: KoppelingenAction): KoppelingenState {
  switch (action.type) {
    case "draft-change":
      return { ...state, forwardDraft: action.value, forwardError: false };
    case "draft-commit":
      return {
        ...state,
        forwardAddress: action.address,
        forwardDraft: action.address,
        forwardError: false,
      };
    case "draft-invalid":
      return { ...state, forwardError: true };
    case "show-own":
      return { ...state, showOwn: true };
    case "read-retry":
      return {
        ...state,
        server: {
          status: "loading",
          attempt: state.server.status === "loading" ? state.server.attempt + 1 : 1,
        },
      };
    case "server-ok":
      return { ...state, server: { status: "ok", localPart: action.localPart } };
    case "server-error":
      return { ...state, server: { status: "error" } };
    case "adopt":
      return {
        ...state,
        server: { status: "ok", localPart: action.serverPart },
        create: { status: "idle", info: action.info ?? null },
        ...(action.localAddress !== null
          ? {
              forwardAddress: action.localAddress,
              forwardDraft: action.localAddress,
              forwardError: false,
            }
          : {}),
      };
    case "create-start":
      return { ...state, create: { status: "creating" } };
    case "create-taken":
      return { ...state, create: { status: "taken" } };
    case "create-failed":
      return { ...state, create: { status: "failed", note: action.note } };
    case "record-confirm":
      return { ...state, record: { status: "confirming", address: action.address } };
    case "record-cancel":
      return { ...state, record: { status: "idle", note: null } };
    case "record-start":
      return { ...state, record: { status: "recording", address: action.address } };
    case "record-done":
      return {
        ...state,
        record: { status: "idle", note: action.note },
        ...(action.storedLocalPart !== undefined
          ? { server: { status: "ok", localPart: action.storedLocalPart } }
          : {}),
      };
  }
}

export default function Koppelingen({ fetchImpl, onNavigate }: KoppelingenProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].koppelingen;
  const [state, dispatch] = useReducer(koppelingenReducer, undefined, (): KoppelingenState => {
    const initial = getInvoiceForwardAddress();
    return {
      forwardAddress: initial,
      forwardDraft: initial,
      forwardError: false,
      showOwn: false,
      server: { status: "loading", attempt: 0 },
      record: { status: "idle", note: null },
      create: { status: "idle", info: null },
    };
  });
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const serverGenRef = useRef(0);
  const createBusy = useRef(false);
  const recordBusy = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const readAttempt = state.server.status === "loading" ? state.server.attempt : -1;

  /* READ ONLY. Deze effect POST't nooit — het schrijft alleen naar de server
   * op een expliciete klik door `doRecord`, nooit hierdoor, ongeacht wat
   * localStorage op dat moment bevat. */
  useEffect(() => {
    if (readAttempt < 0) return;
    let cancelled = false;
    const gen = ++serverGenRef.current;
    void fetchForwardAddress(fetchImpl).then((outcome) => {
      if (cancelled || !mountedRef.current || serverGenRef.current !== gen) return;
      if (outcome.kind === "ok") {
        dispatch({ type: "server-ok", localPart: outcome.localPart });
      } else {
        dispatch({ type: "server-error" });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAttempt]);

  /* Eén stap: een vers adres verzinnen EN op de server vastleggen. Lokaal wordt
   * pas geschreven als de server "stored" zei, zodat een mislukte of botsende
   * poging niets achterlaat. Alleen aangeboden als de server nog geen adres
   * heeft: anders zou dit een live adres vervangen en blijft post naar het oude
   * adres onopgemerkt liggen. */
  async function handleCreateAddress() {
    if (createBusy.current || recordBusy.current) return;
    createBusy.current = true;
    dispatch({ type: "create-start" });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = generateInvoiceForwardAddress();
        const localPart = candidate.split("@")[0];
        const outcome = await recordForwardAddress(localPart, fetchImpl, { ifAbsent: true });
        if (!mountedRef.current) return;
        if (outcome.kind === "taken") continue;
        if (outcome.kind === "already-set") {
          adopt(
            `${outcome.localPart}@${INVOICE_FORWARD_DOMAIN}`,
            outcome.localPart,
            () => c.forwardAddress.createAlreadySet(displayAddressFor(outcome.localPart)),
          );
          return;
        }
        if (outcome.kind !== "stored") {
          dispatch({ type: "create-failed", note: c.forwardAddress.createFailed });
          return;
        }
        adopt(candidate, outcome.localPart);
        posthog.capture("invoice_forward_address_created");
        return;
      }
      if (mountedRef.current) dispatch({ type: "create-taken" });
    } finally {
      createBusy.current = false;
    }
  }

  /* The server is the truth. Keep a copy on this device when the browser lets us;
   * when it does not, the server's address is still what we show. */
  function adopt(address: string, serverPart: string, buildInfo?: () => string) {
    serverGenRef.current += 1;
    const localAddress = setInvoiceForwardAddress(address) ? getInvoiceForwardAddress() : null;
    const info = buildInfo ? buildInfo() : null;
    dispatch({ type: "adopt", serverPart, localAddress, info });
  }

  /* What this device now holds for that local part, else the bare local part. */
  function displayAddressFor(localPart: string): string {
    const stored = getInvoiceForwardAddress();
    return stored.split("@")[0] === localPart ? stored : localPart;
  }

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(state.forwardAddress);
      if (!mountedRef.current) return;
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 1500);
    } catch {
      /* clipboard permission denied, or unavailable */
    }
  }

  function displayAddress(localPart: string, baseAddress = state.forwardAddress): string {
    const draftLocalPart = baseAddress.includes("@") ? baseAddress.split("@")[0] : "";
    return draftLocalPart === localPart ? baseAddress : localPart;
  }

  async function doRecord() {
    if (state.record.status !== "confirming" || recordBusy.current || createBusy.current) return;
    const confirmedAddress = state.record.address;
    recordBusy.current = true;
    serverGenRef.current += 1;
    dispatch({ type: "record-start", address: confirmedAddress });
    try {
      const localPart = confirmedAddress.split("@")[0];
      const outcome = await recordForwardAddress(localPart, fetchImpl);
      if (!mountedRef.current) return;
      if (outcome.kind === "stored") {
        serverGenRef.current += 1;
        dispatch({
          type: "record-done",
          storedLocalPart: outcome.localPart,
          note: c.forwardAddress.server.recorded(
            displayAddress(outcome.localPart, confirmedAddress),
          ),
        });
        posthog.capture("invoice_forward_address_recorded");
        return;
      }
      if (outcome.kind === "taken")
        return dispatch({ type: "record-done", note: c.forwardAddress.server.taken });
      if (outcome.kind === "invalid")
        return dispatch({ type: "record-done", note: c.forwardAddress.server.invalid });
      if (outcome.kind === "unauthorized")
        return dispatch({ type: "record-done", note: c.forwardAddress.server.unauthorized });
      dispatch({ type: "record-done", note: c.forwardAddress.server.recordFailed });
    } finally {
      recordBusy.current = false;
    }
  }

  const { forwardAddress, forwardDraft, forwardError, showOwn, server, record, create } = state;
  const serverState = server.status;
  const serverLocalPart = server.status === "ok" ? server.localPart : null;
  const creating = create.status === "creating";
  const createTaken = create.status === "taken";
  const createNote = create.status === "failed" ? create.note : null;
  const createInfo = create.status === "idle" ? create.info : null;
  const confirmRecord = record.status === "confirming" || record.status === "recording";
  const recording = record.status === "recording";
  const recordNote = record.status === "idle" ? record.note : null;
  const confirmedAddress =
    record.status === "confirming" || record.status === "recording"
      ? record.address
      : forwardAddress;
  const canCreate = serverState === "ok" && !serverLocalPart;

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
      {(forwardAddress || showOwn) && (
        <>
          <label htmlFor="forward-address" style={{ display: "block", margin: "0 0 var(--sp-1)" }}>
            {c.forwardAddress.addressLabel}
          </label>
          <div className="flex gap-2" style={{ margin: "0 0 var(--sp-3)", maxWidth: "28rem" }}>
            <input
              id="forward-address"
              className="w-full"
              value={forwardDraft}
              disabled={confirmRecord}
              placeholder={c.forwardAddress.addressPlaceholder}
              aria-label={c.forwardAddress.addressAriaLabel}
              onChange={(e) => {
                dispatch({ type: "draft-change", value: e.target.value });
              }}
              onBlur={() => {
                if (confirmRecord) return;
                if (setInvoiceForwardAddress(forwardDraft)) {
                  dispatch({ type: "draft-commit", address: getInvoiceForwardAddress() });
                } else {
                  dispatch({ type: "draft-invalid" });
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
            <StatusLine
              tone="problem"

              role="alert"
              style={{ margin: "0 0 var(--sp-3)" }}
            >
              {c.forwardAddress.invalidError}
            </StatusLine>
          )}
        </>
      )}
      {!forwardAddress && !forwardError && (
        <div style={{ margin: "0 0 var(--sp-3)" }}>
          {!(serverState === "ok" && serverLocalPart) && (
            <p className="cell-sub">{c.forwardAddress.emptyIntro}</p>
          )}
          {canCreate && (
            <p>
              <Button
                variant="primary"
                disabled={creating}
                onClick={() => void handleCreateAddress()}
              >
                {creating
                  ? c.forwardAddress.creating
                  : createTaken
                    ? c.forwardAddress.createTakenRetry
                    : c.forwardAddress.createButton}
              </Button>
            </p>
          )}
          {!showOwn && (
            <p>
              <Button onClick={() => dispatch({ type: "show-own" })}>
                {c.forwardAddress.useOwnButton}
              </Button>
            </p>
          )}
          {createTaken && (
            <p className="cell-sub" role="alert">
              {c.forwardAddress.createTaken}
            </p>
          )}
          {createNote && (
            <StatusLine tone="warning" className="cell-sub" role="alert">
              {createNote}
            </StatusLine>
          )}
        </div>
      )}
      {createInfo && (
        <p className="cell-sub" role="status">
          {createInfo}
        </p>
      )}
      {forwardAddress && onNavigate && (
        <p>
          <Button
            onClick={() => {
              // App.setView keeps the search but drops the hash, so the anchor
              // is set after it has been told to change view; the guide card
              // scrolls to it on mount and clears it again.
              onNavigate("facturen");
              try {
                window.history.replaceState(
                  window.history.state,
                  "",
                  `${window.location.pathname}${window.location.search}#${FORWARDING_GUIDE_ANCHOR}`,
                );
              } catch {
                /* the view still changes; only the scroll is lost */
              }
            }}
          >
            {c.forwardAddress.setupLink}
          </Button>
        </p>
      )}

      {/* HET SERVER-ADRES, ERONDER. Dit blok leest wat de server daadwerkelijk
       * gebruikt om de wachtrij mee op te halen — dat kan afwijken van het
       * lokale concept hierboven totdat hij expliciet op "Gebruik dit adres"
       * klikt en dat bevestigt. Zie doRecord: alleen die klik schrijft. */}
      {serverState === "loading" && <p className="cell-sub">{c.forwardAddress.server.loading}</p>}
      {serverState === "error" && (
        <StatusLine tone="problem" className="cell-sub" role="status">
          {c.forwardAddress.server.readFailed}{" "}
          <Button onClick={() => dispatch({ type: "read-retry" })}>
            {c.forwardAddress.server.retryButton}
          </Button>
        </StatusLine>
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
          <Button onClick={() => dispatch({ type: "record-confirm", address: forwardAddress })}>
            {c.forwardAddress.server.recordButton}
          </Button>
        </p>
      )}
      {forwardAddress && confirmRecord && (
        <>
          <StatusLine tone="warning" role="alert">
            {c.forwardAddress.server.confirmWarning(confirmedAddress)}
          </StatusLine>
          <p>
            <Button variant="primary" disabled={recording} onClick={() => void doRecord()}>
              {recording
                ? c.forwardAddress.server.recording
                : c.forwardAddress.server.confirmButton}
            </Button>{" "}
            <Button disabled={recording} onClick={() => dispatch({ type: "record-cancel" })}>
              {c.forwardAddress.server.cancelButton}
            </Button>
          </p>
        </>
      )}
      {recordNote && <p className="cell-sub">{recordNote}</p>}
    </Card>
  );
}
