import { useEffect, useId, useRef, useState } from "react";
import {
  agentApi,
  type AgentApi,
  type AgentChannelName,
  type AgentSettingsInput,
  type AgentSettingsRecord,
} from "../api.js";
import { browserPush, type PushBrowser } from "../agent/pushBrowser.js";
import { instinctCopy } from "../copy/instinct.js";
import type { Locale } from "../locale.js";
import type { View } from "../appRoutes.js";
import Button from "../components/ui/Button.js";
import Card, { CardHeader } from "../components/ui/Card.js";
import { AgentEventList } from "./AgentFeed.js";

/* Daily message settings. Opt in is explicit: the exact consent sentence, a
 * checkbox, then "Zet aan". Turning off deletes the server copy, so it asks
 * first. Push permission is requested only when the user ticks the push box. */

/* Stored and sent, not shown: the daily run ignores it. Kept so an hourly schedule can return. */
const DEFAULT_HOUR = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLL_MS = 3000;
/* 15 minutes of polling, then the code is treated as expired. */
const MAX_POLLS = (15 * 60 * 1000) / POLL_MS;

type Loaded = {
  settings: AgentSettingsRecord | null;
  bankConnected: boolean;
  consentVersion: string;
  vapidPublicKey: string | null;
};
type Phase =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | ({ kind: "ready" } & Loaded);
type Notice =
  | "saved"
  | "saveFailed"
  | "bankRequired"
  | "unavailable"
  | "pushDenied"
  | "pushUnsupported"
  | "pushFailed"
  | "waLinkFailed"
  | "waUnlinkFailed"
  | null;
type WaState =
  | { status: "unlinked"; number: string | null }
  | { status: "linking"; code: string; expiresAt: string; number: string | null }
  | { status: "timed-out"; code: string; expiresAt: string; number: string | null }
  | { status: "linked"; phone: string | null; number: string | null; justLinked: boolean };

const clock = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(iso));

export default function AgentSettings({
  locale,
  accountEmail = "",
  onEnabledChange,
  onNavigate,
  api = agentApi,
  browser = browserPush,
}: {
  locale: Locale;
  /** Prefills the email box; the user can change it. */
  accountEmail?: string;
  onEnabledChange?: (enabled: boolean) => void;
  onNavigate?: (view: View) => void;
  api?: AgentApi;
  browser?: PushBrowser;
}) {
  const c = instinctCopy[locale];
  const ids = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [push, setPush] = useState(false);
  const [emailOn, setEmailOn] = useState(false);
  const [waOn, setWaOn] = useState(false);
  const [wa, setWa] = useState<WaState>({ status: "unlinked", number: null });
  /* Separate from the daily-message consent: WhatsApp questions go to the AI provider. */
  const [aiConsent, setAiConsent] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const linkRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"code" | "link" | null>(null);
  const [email, setEmail] = useState(accountEmail);
  const [hour, setHour] = useState(DEFAULT_HOUR);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const alive = useRef(true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const turnOffRef = useRef<HTMLButtonElement>(null);
  const confirmWasOpen = useRef(false);

  function beginBusy(): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }
  function endBusy() {
    busyRef.current = false;
    if (alive.current) setBusy(false);
  }

  /* The confirm destroys server data: focus goes to the safe button on open
   * and back to "Zet uit" on close, so keyboard users never lose their place. */
  useEffect(() => {
    if (confirmOff) cancelRef.current?.focus();
    else if (confirmWasOpen.current) turnOffRef.current?.focus();
    confirmWasOpen.current = confirmOff;
  }, [confirmOff]);

  function adopt(loaded: Loaded) {
    const s = loaded.settings;
    setPhase({
      kind: "ready",
      settings: s,
      bankConnected: loaded.bankConnected,
      consentVersion: loaded.consentVersion,
      vapidPublicKey: loaded.vapidPublicKey,
    });
    if (s?.enabled) {
      setPush(s.channels.includes("push"));
      setEmailOn(s.channels.includes("email"));
      setWaOn(s.channels.includes("whatsapp"));
      setEmail(s.email ?? accountEmail);
      setHour(s.sendHour);
    }
  }

  useEffect(() => {
    alive.current = true;
    void api.getSettings().then((res) => {
      if (!alive.current) return;
      if (res.kind === "ok") adopt(res);
      else setPhase({ kind: res.kind });
    });
    void api.getWhatsapp().then((res) => {
      if (alive.current && res.kind === "ok") {
        setWa(
          res.linked
            ? { status: "linked", phone: res.phone, number: res.number, justLinked: false }
            : { status: "unlinked", number: res.number },
        );
      }
    });
    return () => {
      alive.current = false;
    };
    // The api object is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The focused button unmounts when the panel opens/closes or on unlink: put
   * focus on its successor instead of letting it fall to the page. */
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    const el = target === "code" ? codeRef.current : linkRef.current;
    if (!el) return;
    focusAfter.current = null;
    el.focus();
  });

  const polling = wa.status === "linking";
  const linkingCode = wa.status === "linking" ? wa.code : null;
  useEffect(() => {
    if (!polling) return;
    let polls = 0;
    let inFlight = false;
    let stopped = false;
    const id = setInterval(() => {
      polls += 1;
      if (polls >= MAX_POLLS) {
        clearInterval(id);
        setWa((cur) =>
          cur.status === "linking" ? { ...cur, status: "timed-out" } : cur,
        );
        return;
      }
      if (inFlight || document.hidden) return;
      inFlight = true;
      void api.getWhatsapp().then((res) => {
        inFlight = false;
        if (stopped || !alive.current || res.kind !== "ok" || !res.linked) return;
        clearInterval(id);
        setWa({ status: "linked", phone: res.phone, number: res.number, justLinked: true });
      });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // The api object is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, linkingCode]);

  useEffect(() => {
    setEmail((cur) => (cur === "" ? accountEmail : cur));
  }, [accountEmail]);

  if (phase.kind === "loading")
    return (
      <Shell c={c}>
        <p className="cell-sub">{c.loading}</p>
      </Shell>
    );
  if (phase.kind === "signedOut")
    return (
      <Shell c={c}>
        <p role="alert">{c.signInNeeded}</p>
      </Shell>
    );
  if (phase.kind === "unavailable")
    return (
      <Shell c={c}>
        <p role="alert">{c.unavailable}</p>
      </Shell>
    );
  if (phase.kind === "error")
    return (
      <Shell c={c}>
        <p role="alert" className="text-warn">
          {c.loadFailed}
        </p>
      </Shell>
    );

  const { settings, bankConnected, consentVersion, vapidPublicKey } = phase;
  const enabled = settings?.enabled === true;
  const stale = enabled && settings.consentVersion !== consentVersion;
  const needsConsent = !enabled || stale;
  const pushSupported = browser.supported();
  const emailOk = !emailOn || EMAIL.test(email);
  const canSave = !busy && emailOk && (!needsConsent || (consent && (bankConnected || stale)));

  async function togglePush(on: boolean) {
    if (busyRef.current) return;
    setNotice(null);
    if (!on) {
      setPush(false);
      return;
    }
    if (!pushSupported) {
      setNotice("pushUnsupported");
      return;
    }
    let permission = browser.permission();
    if (permission === "default") {
      if (!beginBusy()) return;
      try {
        permission = await browser.request();
      } finally {
        endBusy();
      }
    }
    if (!alive.current) return;
    if (permission !== "granted") {
      setPush(false);
      setNotice("pushDenied");
      return;
    }
    setPush(true);
  }

  async function syncPush(wasOn: boolean): Promise<boolean> {
    if (push) {
      if (!vapidPublicKey) return false;
      try {
        const sub = await browser.subscribe(vapidPublicKey);
        return sub !== null && (await api.putPush(sub));
      } catch {
        return false;
      }
    }
    if (wasOn) {
      try {
        const endpoint = await browser.unsubscribe();
        if (endpoint) await api.deletePush(endpoint);
      } catch {
        /* the server copy is dropped when it is turned off or replaced */
      }
    }
    return true;
  }

  async function startLink() {
    if (!aiConsent || !beginBusy()) return;
    setNotice(null);
    try {
      const res = await api.createLinkCode(true);
      if (!alive.current) return;
      if (res.kind !== "ok") {
        setNotice("waLinkFailed");
        return;
      }
      focusAfter.current = "code";
      setWa((cur) => ({
        status: "linking",
        code: res.code,
        expiresAt: res.expiresAt,
        number: res.number ?? cur.number,
      }));
    } finally {
      endBusy();
    }
  }

  async function unlink() {
    if (!beginBusy()) return;
    setNotice(null);
    try {
      const ok = await api.unlinkWhatsapp();
      if (!alive.current) return;
      if (!ok) {
        setNotice("waUnlinkFailed");
        return;
      }
      focusAfter.current = "link";
      setWa((w) => ({ status: "unlinked", number: w.number }));
      setWaOn(false);
      if (settings?.enabled && !stale && settings.channels.includes("whatsapp")) {
        const input: AgentSettingsInput = {
          enabled: true,
          channels: settings.channels.filter((ch) => ch !== "whatsapp"),
          sendHour: settings.sendHour,
          locale: settings.locale,
          email: settings.email,
          consentVersion: settings.consentVersion,
        };
        const res = await api.putSettings(input);
        if (!alive.current) return;
        if (res.kind === "ok")
          setPhase((p) =>
            p.kind === "ready"
              ? { ...p, settings: { ...input, consentedAt: settings.consentedAt } }
              : p,
          );
        else setNotice("saveFailed");
      }
    } finally {
      endBusy();
    }
  }

  async function save() {
    if (!beginBusy()) return;
    setNotice(null);
    try {
      const channels: AgentChannelName[] = ["feed"];
      if (push) channels.push("push");
      if (emailOn) channels.push("email");
      if (waOn && wa.status === "linked") channels.push("whatsapp");
      const input = {
        enabled: true as const,
        channels,
        sendHour: hour,
        locale,
        email: emailOn ? email.trim() : null,
        consentVersion,
      };
      const res = await api.putSettings(input);
      if (!alive.current) return;
      if (res.kind !== "ok") {
        setNotice(
          res.kind === "bank-required"
            ? "bankRequired"
            : res.kind === "unavailable"
              ? "unavailable"
              : "saveFailed",
        );
        return;
      }
      const pushOk = await syncPush(settings?.channels.includes("push") === true);
      if (!alive.current) return;
      let saved = input;
      if (!pushOk && push) {
        /* The server must not keep "push" when this browser has no subscription. */
        setPush(false);
        saved = { ...input, channels: input.channels.filter((ch) => ch !== "push") };
        await api.putSettings(saved);
        if (!alive.current) return;
      }
      const consentedAt = settings?.consentedAt ?? new Date().toISOString();
      setPhase((p) => (p.kind === "ready" ? { ...p, settings: { ...saved, consentedAt } } : p));
      setConsent(false);
      setNotice(pushOk ? "saved" : "pushFailed");
      onEnabledChange?.(true);
    } finally {
      endBusy();
    }
  }

  async function turnOff() {
    if (!beginBusy()) return;
    setNotice(null);
    try {
      const res = await api.turnOff();
      if (!alive.current) return;
      setConfirmOff(false);
      if (res.kind !== "ok") {
        setNotice(res.kind === "unavailable" ? "unavailable" : "saveFailed");
        return;
      }
      try {
        await browser.unsubscribe();
      } catch {
        /* nothing left to unsubscribe from */
      }
      if (!alive.current) return;
      setPhase((p) => (p.kind === "ready" ? { ...p, settings: null } : p));
      setPush(false);
      setEmailOn(false);
      setWaOn(false);
      setWa((w) => ({ status: "unlinked", number: w.number }));
      setConsent(false);
      onEnabledChange?.(false);
    } finally {
      endBusy();
    }
  }

  return (
    <Shell c={c}>
      {needsConsent && (
        <section aria-label={stale ? c.reconsentTitle : c.consentCheckbox}>
          {stale ? (
            <>
              <h3>{c.reconsentTitle}</h3>
              <p>{c.reconsentBody}</p>
            </>
          ) : (
            <p className="cell-sub">{c.switchLabel}</p>
          )}
          <p data-testid="instinct-consent">{c.consent}</p>
          <p className="cell-sub">
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              {c.privacyLink}
            </a>
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            {c.consentCheckbox}
          </label>
        </section>
      )}

      {!bankConnected && !enabled && (
        <p>
          {c.noBank}{" "}
          {onNavigate && <Button onClick={() => onNavigate("accounts")}>{c.bankLink}</Button>}
        </p>
      )}

      <fieldset>
        <legend>{c.channelsLabel}</legend>
        <p>
          <label>
            <input type="checkbox" checked disabled /> {c.channels.feed}
          </label>{" "}
          <span className="cell-sub">{c.inAppAlways}</span>
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={push}
              disabled={!pushSupported || busy}
              onChange={(e) => void togglePush(e.target.checked)}
            />{" "}
            {c.channels.push}
          </label>
          {!pushSupported && <span className="cell-sub"> {c.pushUnsupported}</span>}
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={emailOn}
              onChange={(e) => setEmailOn(e.target.checked)}
            />{" "}
            {c.channels.email}
          </label>
        </p>
        {emailOn && (
          <p>
            <label htmlFor={`${ids}-email`}>{c.emailLabel}</label>{" "}
            <input
              id={`${ids}-email`}
              type="email"
              autoComplete="email"
              value={email}
              aria-invalid={!emailOk}
              aria-describedby={emailOk ? undefined : `${ids}-email-err`}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!emailOk && (
              <span id={`${ids}-email-err`} role="alert" className="text-warn">
                {" "}
                {c.emailInvalid}
              </span>
            )}
          </p>
        )}
        <p>
          <label>
            <input
              type="checkbox"
              checked={waOn && wa.status === "linked"}
              disabled={wa.status !== "linked"}
              onChange={(e) => setWaOn(e.target.checked)}
            />{" "}
            {c.whatsapp}
          </label>{" "}
          {wa.status === "linked" ? (
            <>
              <span className="cell-sub">{c.whatsappLinked(wa.phone ?? "")}</span>{" "}
              <Button disabled={busy} onClick={() => void unlink()}>
                {c.whatsappUnlink}
              </Button>
            </>
          ) : (
            <span className="cell-sub">{enabled ? c.whatsappNeedsLink : c.whatsappNeedsOn}</span>
          )}
        </p>
        <p role="status" data-testid="wa-status">
          {wa.status === "linking"
            ? c.whatsappWaiting
            : wa.status === "linked" && wa.justLinked
              ? c.whatsappLinkedNow
              : ""}
        </p>
        {enabled && (wa.status === "unlinked" || wa.status === "timed-out") && (
          <p>
            <label>
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={(e) => setAiConsent(e.target.checked)}
              />{" "}
              {c.whatsappAiConsent}
            </label>{" "}
            {wa.status === "timed-out" && (
              <>
                <span role="alert" className="text-warn">
                  {c.whatsappTimedOut}
                </span>{" "}
              </>
            )}
            {/* aria-disabled, not disabled: focus returns here after an unlink and must be able to land. */}
            <Button
              ref={linkRef}
              disabled={busy}
              aria-disabled={!aiConsent}
              onClick={() => void startLink()}
            >
              {c.whatsappLink}
            </Button>
          </p>
        )}
        {wa.status === "linking" && (
          <div role="group" aria-label={c.whatsapp}>
            <p>{c.whatsappSend(wa.number)}</p>
            <p>
              {c.whatsappCodeLabel}:{" "}
              <code ref={codeRef} tabIndex={-1}>
                {wa.code}
              </code>
            </p>
            <p className="cell-sub">{c.whatsappExpires(clock(wa.expiresAt, locale))}</p>
            <Button
              disabled={busy}
              onClick={() => {
                focusAfter.current = "link";
                setWa((w) => ({ status: "unlinked", number: w.number }));
              }}
            >
              {c.whatsappClose}
            </Button>
          </div>
        )}
      </fieldset>

      <p className="cell-sub">{c.scheduleNote}</p>

      {notice && notice !== "saved" && (
        <p role="alert" className="text-warn">
          {notice === "bankRequired" ? (
            <>
              {c.bankRequired}{" "}
              {onNavigate && <Button onClick={() => onNavigate("accounts")}>{c.bankLink}</Button>}
            </>
          ) : notice === "unavailable" ? (
            c.unavailable
          ) : notice === "pushDenied" ? (
            c.pushDenied
          ) : notice === "pushUnsupported" ? (
            c.pushUnsupported
          ) : notice === "pushFailed" ? (
            c.pushFailed
          ) : notice === "waLinkFailed" ? (
            c.whatsappLinkFailed
          ) : notice === "waUnlinkFailed" ? (
            c.whatsappUnlinkFailed
          ) : (
            c.saveFailed
          )}
        </p>
      )}
      {notice === "saved" && <p role="status">{c.saved}</p>}

      <p>
        {needsConsent ? (
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {stale ? c.reconsentButton : c.turnOn}
          </Button>
        ) : (
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {c.save}
          </Button>
        )}{" "}
        {enabled && (
          <Button
            ref={turnOffRef}
            disabled={busy || confirmOff}
            onClick={() => setConfirmOff(true)}
          >
            {c.turnOff}
          </Button>
        )}
      </p>

      {confirmOff && (
        <div role="alertdialog" aria-label={c.turnOff} aria-describedby={`${ids}-confirm`}>
          <p id={`${ids}-confirm`}>{c.turnOffConfirm}</p>
          <Button variant="primary" disabled={busy} onClick={() => void turnOff()}>
            {c.turnOffConfirmYes}
          </Button>{" "}
          <Button ref={cancelRef} disabled={busy} onClick={() => setConfirmOff(false)}>
            {c.turnOffConfirmNo}
          </Button>
        </div>
      )}
      <p className="cell-sub">{c.offNote}</p>

      <h3>{c.storedHeading}</h3>
      {enabled ? (
        <AgentEventList locale={locale} api={api} emptyText={c.storedEmpty} />
      ) : (
        <p className="cell-sub">{c.storedEmpty}</p>
      )}
    </Shell>
  );
}

function Shell({ c, children }: { c: (typeof instinctCopy)["nl"]; children: React.ReactNode }) {
  return (
    <Card as="section" aria-label={c.title}>
      <CardHeader>
        <h2>{c.title}</h2>
      </CardHeader>
      {children}
    </Card>
  );
}
