import { useEffect, useRef, useState } from "react";
import { useAppLocale } from "../appLocale.js";
import { adminCopy } from "../copy/admin.js";
import Button from "../components/ui/Button.js";
import {
  GMAIL_FILTER_QUERY,
  GMAIL_FILTERS_URL,
  GMAIL_FORWARDING_URL,
  OUTLOOK_COM_RULES_URL,
  OUTLOOK_WORK_RULES_URL,
  RULE_WORDS,
  adoptFreshConfirmation,
  codeStatus,
  currentConfirmation,
  dismissUnreadable,
  guideStage,
  retryCodeWait,
  setTab,
  testStatus,
  testSubject,
  toggleTick,
  type GuideState,
  type GuideTab,
} from "../forwardingGuide.js";

/** The anchor the Koppelingen link lands on. */
export const FORWARDING_GUIDE_ANCHOR = "forwarding-guide";

export type ForwardingGuideProps = {
  /** "" when there is none. */
  address: string;
  state: GuideState;
  nowMs: number;
  /** An updater, applied by the owner to its CURRENT state: a fetch may have
   *  committed a code since this render, and a snapshot would overwrite it. */
  onChange: (update: (prev: GuideState) => GuideState) => void;
  /** Facturen creates the code and starts the clock. */
  onStartTest: () => void;
  onOpenKoppelingen: () => void;
};

/** A copy button that flips its label for 1.5 s. A denied clipboard changes nothing. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable: the text is on screen and can be selected by hand */
    }
  }
  return { copied, copy };
}

function ExternalLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: string;
  onClick?: () => void;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      {children}
    </a>
  );
}

function StepRow({
  label,
  checked,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2 items-start">
      <input type="checkbox" aria-label={label} checked={checked} onChange={onToggle} />
      <div>{children}</div>
    </li>
  );
}

export default function ForwardingGuide({
  address,
  state,
  nowMs,
  onChange,
  onStartTest,
  onOpenKoppelingen,
}: ForwardingGuideProps) {
  const [locale] = useAppLocale();
  const c = adminCopy[locale].facturen.guide;
  /* Only the modal's visibility is local. The guide state and the poll stay in
   * Facturen, so closing the modal never stops a wait or drops a fetched code. */
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const { copied, copy } = useCopy();
  const hasAddress = address !== "";

  const fmt = (ms: number) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(ms);

  const code = codeStatus(state, nowMs);
  const confirmation = currentConfirmation(state, nowMs);
  const status = testStatus(state, nowMs);
  const stage = guideStage(state, nowMs, hasAddress);
  // The row reads a recent code the pull stored before the modal was ever opened.
  const rowStage = guideStage(
    state.passedAtMs === null ? adoptFreshConfirmation(state, nowMs) : state,
    nowMs,
    hasAddress,
  );
  const gmail = state.tab === "gmail";

  /* Same open/close mechanism as the landing sign-in dialog (Landing.tsx): always
   * mounted, state drives showModal()/close(), the `close` event is not relied on. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      openerRef.current?.focus();
    }
  }, [open]);

  /* Gmail sends its confirmation as soon as the address is added, which can be
   * before the user ticks anything. A code seen before the wait began is stale
   * (codeStatus), so the wait starts when the Gmail steps are shown (the modal
   * open on the Gmail tab), and again on the settings link. Not once a test has
   * passed: the guide is then done. */
  const needsWait = hasAddress && open && gmail && state.passedAtMs === null && code === "none";
  useEffect(() => {
    if (needsWait)
      onChange((s) => {
        if (codeStatus(s, nowMs) !== "none") return s;
        const adopted = adoptFreshConfirmation(s, nowMs);
        return adopted !== s ? adopted : retryCodeWait(s, nowMs);
      });
    // Only the transition into "needs a wait" matters; state/nowMs are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWait]);

  /* Koppelingen links here (#forwarding-guide): open the modal on arrival. */
  useEffect(() => {
    if (window.location.hash !== `#${FORWARDING_GUIDE_ANCHOR}`) return;
    setOpen(true);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, []);

  function onSettingsLink() {
    onChange((s) => {
      const now = codeStatus(s, nowMs);
      return now === "none" || now === "timed-out" ? retryCodeWait(s, nowMs) : s;
    });
  }

  function tick(id: string) {
    onChange((s) => {
      const next = toggleTick(s, id, nowMs);
      const status = codeStatus(s, nowMs);
      const running = status === "waiting" || status === "received";
      // toggleTick restarts the wait at "now": keep the one already running, or a
      // code that arrived before this click would turn stale.
      return id === "gmail:1" && !s.ticks.includes(id) && running
        ? { ...next, codeWaitStartedAtMs: s.codeWaitStartedAtMs }
        : next;
    });
  }

  const sp = (id: string, n: number) => ({
    label: c.stepDoneAria(n),
    checked: state.ticks.includes(id),
    onToggle: () => tick(id),
  });

  const passedAt = state.test?.receivedAtMs ?? state.passedAtMs;
  const rowText =
    rowStage === "test-passed" && passedAt !== null
      ? c.rowPassed(fmt(passedAt))
      : rowStage === "test-passed"
        ? c.stages[rowStage]
        : c.rowStatus[rowStage];

  return (
    <section id={FORWARDING_GUIDE_ANCHOR} className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" ref={openerRef} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {c.openButton}
        </Button>
        <p className={`cell-sub m-0${state.setupUnreadable > 0 ? " text-warn" : ""}`} role="status">
          {rowText}
          {state.setupUnreadable > 0 && ` ${c.setupUnreadable.message}`}
        </p>
      </div>
      <dialog
        ref={dialogRef}
        className="guide-dialog"
        aria-label={c.ariaLabel}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <button
          type="button"
          className="guide-dialog-close"
          aria-label={c.closeButton}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        <div className="guide-dialog-body">
          <h3 className="m-0 mb-2">{c.heading}</h3>
          {open && (
            <>
              {state.setupUnreadable > 0 && (
                <p className="cell-sub text-warn" role="status">
                  {c.setupUnreadable.message}{" "}
                  <Button type="button" onClick={() => onChange(dismissUnreadable)}>
                    {c.setupUnreadable.dismiss}
                  </Button>
                </p>
              )}
              {!hasAddress ? (
                <>
                  <p className="cell-sub">{c.noAddress}</p>
                  <Button type="button" onClick={onOpenKoppelingen}>
                    {c.goCreateAddress}
                  </Button>
                </>
              ) : (
                <>
                  <p className="cell-sub" role="status">
                    {c.stages[stage]}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="cell-sub">{c.addressLabel}</span>
                    <code>{address}</code>
                    <Button type="button" onClick={() => void copy("address", address)}>
                      {copied === "address" ? c.copiedLabel : c.copyButton}
                    </Button>
                  </div>
                  <div
                    role="tablist"
                    aria-label={c.tabsAriaLabel}
                    className="flex flex-wrap gap-2 mt-2"
                  >
                    {(["gmail", "outlook"] as const satisfies readonly GuideTab[]).map((tab) => (
                      <Button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={state.tab === tab}
                        variant={state.tab === tab ? "primary" : "default"}
                        onClick={() => onChange((s) => setTab(s, tab))}
                      >
                        {tab === "gmail" ? c.tabGmail : c.tabOutlook}
                      </Button>
                    ))}
                  </div>
                  <p className="cell-sub">{c.otherApps}</p>

                  {gmail ? (
                    <ol className="list-none p-0 grid gap-2">
                      <StepRow {...sp("gmail:1", 1)}>
                        <p className="m-0">{c.gmail.step1}</p>
                        <p className="m-0">
                          <ExternalLink href={GMAIL_FORWARDING_URL} onClick={onSettingsLink}>
                            {c.gmail.openSettings}
                          </ExternalLink>
                        </p>
                        <p className="cell-sub m-0">{c.gmail.multiAccountNote}</p>
                      </StepRow>
                      <StepRow {...sp("gmail:2", 2)}>
                        {confirmation ? (
                          <p className="m-0">
                            <strong>{c.gmail.step2Code(confirmation.code)}</strong>{" "}
                            <Button
                              type="button"
                              data-testid="copy-code"
                              onClick={() => void copy("code", confirmation.code)}
                            >
                              {copied === "code" ? c.copiedLabel : c.copyButton}
                            </Button>
                            <span hidden data-testid="gmail-code">
                              {confirmation.code}
                            </span>
                          </p>
                        ) : code === "timed-out" ? (
                          <>
                            <p className="m-0">{c.gmail.step2TimedOut}</p>
                            <Button
                              type="button"
                              onClick={() => onChange((s) => retryCodeWait(s, nowMs))}
                            >
                              {c.gmail.retryCode}
                            </Button>
                          </>
                        ) : (
                          <p className="m-0">{c.gmail.step2Waiting}</p>
                        )}
                        <p className="cell-sub m-0">{c.gmail.step2Warn}</p>
                      </StepRow>
                      <StepRow {...sp("gmail:3", 3)}>
                        <p className="m-0">{c.gmail.step3}</p>
                        <p className="m-0">
                          <ExternalLink href={GMAIL_FILTERS_URL}>
                            {c.gmail.openFilters}
                          </ExternalLink>
                        </p>
                        <p className="m-0">
                          <code>{GMAIL_FILTER_QUERY}</code>{" "}
                          <Button
                            type="button"
                            onClick={() => void copy("query", GMAIL_FILTER_QUERY)}
                          >
                            {copied === "query" ? c.gmail.queryCopied : c.gmail.copyQuery}
                          </Button>
                        </p>
                      </StepRow>
                      <StepRow {...sp("gmail:4", 4)}>
                        <p className="m-0">{c.gmail.step4}</p>
                      </StepRow>
                    </ol>
                  ) : (
                    <ol className="list-none p-0 grid gap-2">
                      <StepRow {...sp("outlook:1", 1)}>
                        <p className="m-0">{c.outlook.step1}</p>
                        <p className="m-0">
                          <ExternalLink href={OUTLOOK_COM_RULES_URL}>
                            {c.outlook.openPersonal}
                          </ExternalLink>{" "}
                          <ExternalLink href={OUTLOOK_WORK_RULES_URL}>
                            {c.outlook.openWork}
                          </ExternalLink>
                        </p>
                      </StepRow>
                      <StepRow {...sp("outlook:2", 2)}>
                        <p className="m-0">{c.outlook.step2(RULE_WORDS)}</p>
                        <p className="cell-sub m-0" role="note">
                          {c.outlook.workNote}
                        </p>
                      </StepRow>
                    </ol>
                  )}

                  <h4 className="mb-1">{c.test.heading}</h4>
                  <p className="cell-sub">{c.test.intro}</p>
                  {state.test && (
                    <p className="m-0">
                      <span className="cell-sub">{c.test.subjectLabel} </span>
                      <code>{testSubject(state.test.code, locale)}</code>{" "}
                      <Button
                        type="button"
                        onClick={() => void copy("subject", testSubject(state.test!.code, locale))}
                      >
                        {copied === "subject" ? c.test.subjectCopied : c.test.copySubject}
                      </Button>
                    </p>
                  )}
                  {status === "pending" && (
                    <p className="cell-sub" role="status">
                      {c.test.pending}
                    </p>
                  )}
                  {status === "passed" && state.test?.receivedAtMs != null && (
                    <p className="cell-sub" role="status">
                      {c.test.passed(fmt(state.test.receivedAtMs))}
                    </p>
                  )}
                  {status === "passed-other-code" && state.test?.receivedAtMs != null && (
                    <p className="cell-sub" role="status">
                      {c.test.passedOtherCode(fmt(state.test.receivedAtMs))}
                    </p>
                  )}
                  {status === "timed-out" && (
                    <>
                      <p className="cell-sub text-warn" role="status">
                        {c.test.timedOut}
                      </p>
                      <ul>
                        {c.test.checklist.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                        <li>{gmail ? c.test.checklistGmail : c.test.checklistOutlook}</li>
                      </ul>
                    </>
                  )}
                  {status !== "pending" && (
                    <Button type="button" onClick={onStartTest}>
                      {status === "none" ? c.test.startButton : c.test.againButton}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </dialog>
    </section>
  );
}
