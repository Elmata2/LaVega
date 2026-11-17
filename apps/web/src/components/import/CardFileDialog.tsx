import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  balanceAskKind,
  parseBalanceReply,
  planCardFiles,
  type Account,
  type CardFileInput,
  type CardFilePlan,
  type Tx,
} from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { cardFileCopy } from "../../copy/cardFile.js";
import { guideFor } from "../../copy/importGuides.js";
import {
  formatPeriod,
  previewCardFile,
  toInput,
  type CardTarget,
  type FilePreview,
} from "../../lib/cardFileImport.js";
import Button from "../ui/Button.js";
import Dialog from "../ui/Dialog.js";
import StatusLine from "../ui/StatusLine.js";

/* One dialog: choose the card, see how to get the file, drop files, check what
 * would be added, confirm. Nothing is written until "Add". Plans are core's
 * `planCardFiles` over the whole list, so each file is counted against the vault
 * plus the earlier files, exactly as the commit will store them. The Dialog
 * shell is the one the Home pop-ups use (focus trap, Escape, backdrop, focus
 * back to the opener). No motion is added here. */

export type CardFileDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The card the dialog was opened for; null = pick one first. */
  card: CardTarget | null;
  choices: readonly CardTarget[];
  entity: string;
  /** What the vault holds now, for the plans. */
  accounts: readonly Account[];
  txs: readonly Tx[];
  asOf: string;
  /** Saves the files, re-planned against the vault as it is at that moment. */
  onCommit: (
    files: CardFileInput[],
    card: CardTarget | null,
  ) => Promise<{ ok: true; count: number; written?: Account[] } | { ok: false; partial: boolean }>;
  /** The EXISTING balance path (Rekeningen's saldo field): key + typed amount. */
  onSaveBalance?: (key: string, value: string) => Promise<void> | void;
  onDone?: (count: number) => void;
};

const OTHER = "__other__";
const PHONE = "(max-width: 640px)";
const isPhone = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE).matches
    : false;

let seq = 0;

export default function CardFileDialog(p: CardFileDialogProps) {
  const [locale] = useAppLocale();
  const c = cardFileCopy[locale];
  const [chosen, setChosen] = useState<CardTarget | typeof OTHER | null>(null);
  // While the write runs, Escape, the backdrop and the cross do nothing.
  const [busy, setBusy] = useState(false);
  const picked = chosen ?? p.card;
  const needsChoice = p.card === null && p.choices.length > 0;
  // A new opening gets a new instance (the host keys it), so the choice starts clean.
  const card: CardTarget | null = picked === OTHER || picked === null ? null : picked;
  const choosing = needsChoice && picked === null;
  const title = card ? c.title(card.name) : c.titleGeneric;
  const firstRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={p.open}
      onClose={() => {
        if (!busy) p.onClose();
      }}
      title={title}
      closeLabel={c.close}
      initialFocusRef={firstRef}
    >
      {p.open &&
        (choosing ? (
          <Choice choices={p.choices} onPick={setChosen} firstRef={firstRef} />
        ) : (
          <Body
            key={card?.id ?? OTHER}
            {...p}
            card={card}
            firstRef={firstRef}
            onBusy={setBusy}
          />
        ))}
    </Dialog>
  );
}

function Choice(p: {
  choices: readonly CardTarget[];
  onPick: (v: CardTarget | typeof OTHER) => void;
  firstRef: React.RefObject<HTMLButtonElement>;
}) {
  const [locale] = useAppLocale();
  const c = cardFileCopy[locale];
  return (
    <div className="card-file">
      <p className="m-0 mb-3">{c.chooseIntro}</p>
      <ul className="m-0 p-0 list-none flex flex-col gap-2" aria-label={c.chooseIntro}>
        {p.choices.map((ch, i) => (
          <li key={`${ch.kind}:${ch.id}`}>
            <Button
              ref={i === 0 ? p.firstRef : null}
              className="w-full min-h-[44px] justify-start"
              onClick={() => p.onPick(ch)}
            >
              {ch.name}
            </Button>
          </li>
        ))}
        <li>
          <Button
            ref={p.choices.length === 0 ? p.firstRef : null}
            className="w-full min-h-[44px] justify-start"
            onClick={() => p.onPick(OTHER)}
          >
            {c.otherChoice}
          </Button>
        </li>
      </ul>
    </div>
  );
}

type Stage = "form" | "adding" | "done";

function Body({
  firstRef,
  onClose,
  onCommit,
  onDone,
  onBusy,
  onSaveBalance,
  entity,
  accounts,
  txs,
  asOf,
  card,
}: CardFileDialogProps & {
  card: CardTarget | null;
  firstRef: React.RefObject<HTMLButtonElement>;
  onBusy: (b: boolean) => void;
}) {
  const [locale] = useAppLocale();
  const c = cardFileCopy[locale];
  const guide = guideFor(card?.brand ?? null, locale);
  const phone = isPhone();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [override, setOverride] = useState<Set<string>>(new Set());
  // "Is this the same card as your existing account?", per file: true = yes.
  const [same, setSame] = useState<Map<string, boolean>>(new Map());
  const [previewed, setPreviewed] = useState(0);
  const [reading, setReading] = useState(0);
  const [stage, setStage] = useState<Stage>("form");
  const [count, setCount] = useState(0);
  // Accounts this import wrote that have no balance yet: asked for once, optionally.
  const [askBalance, setAskBalance] = useState<Account[]>([]);
  const [savedBalance, setSavedBalance] = useState(false);
  const [failed, setFailed] = useState<"none" | "partial" | null>(null);
  const [dragging, setDragging] = useState(false);
  const cardName = card?.name ?? c.otherName;

  async function take(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setFailed(null);
    setReading((n) => n + list.length);
    for (const file of list) {
      seq += 1;
      const preview = await previewCardFile(file, { id: `f${seq}`, entity, card });
      setPreviews((prev) => [...prev, preview]);
      setReading((n) => n - 1);
    }
  }

  // Which files would be written, and their plans: walked in dialog order.
  const { plans, eligible } = useMemo(() => {
    const held = { accounts, txs };
    const ok = (pv: FilePreview) =>
      pv.result !== null &&
      pv.result.problems.length === 0 &&
      pv.result.txs.length > 0 &&
      (pv.matchesCard || override.has(pv.id));
    const el = previews.filter(ok);
    const inputs = el.map((pv) => toInput(pv, card, override.has(pv.id), same.get(pv.id))!);
    const seqPlans = planCardFiles(held, inputs, asOf);
    const map = new Map<string, CardFilePlan>();
    el.forEach((pv, i) => map.set(pv.id, seqPlans[i]!));
    for (const pv of previews) {
      if (map.has(pv.id) || pv.result === null) continue;
      map.set(
        pv.id,
        planCardFiles(held, [toInput(pv, card, override.has(pv.id), same.get(pv.id))!], asOf)[0]!,
      );
    }
    return { plans: map, eligible: el };
  }, [previews, override, same, accounts, txs, asOf, card]);

  // A file with an open question is not written until it is answered.
  const writable = eligible.filter((pv) => plans.get(pv.id)?.question === null);
  const pending = eligible.some((pv) => plans.get(pv.id)?.question != null);
  const somethingNew = !pending && writable.some((pv) => (plans.get(pv.id)?.newCount ?? 0) > 0);

  async function add() {
    setStage("adding");
    onBusy(true);
    setFailed(null);
    setPreviewed(writable.reduce((n, pv) => n + (plans.get(pv.id)?.newCount ?? 0), 0));
    try {
      const r = await onCommit(
        writable.map((pv) => toInput(pv, card, override.has(pv.id), same.get(pv.id))!),
        card,
      );
      if (r.ok) {
        setCount(r.count);
        setAskBalance(onSaveBalance ? (r.written ?? []).filter((a) => a.balance === null) : []);
        setStage("done");
        onDone?.(r.count);
      } else {
        setStage("form");
        setFailed(r.partial ? "partial" : "none");
      }
    } catch {
      // Whatever went wrong, the dialog must not stay stuck with dismissal blocked.
      setStage("form");
      setFailed("partial");
    } finally {
      onBusy(false);
    }
  }

  // Entering the success state: focus goes to the first balance field when there is
  // one, else to the Sluiten button; never to <body>.
  const doneRef = useRef<HTMLDivElement>(null);
  const asking = askBalance.length;
  useEffect(() => {
    if (stage !== "done") return;
    // On entering, and again whenever a field was answered or skipped: the next
    // field, else the Sluiten button.
    const next = doneRef.current?.querySelector<HTMLInputElement>("input");
    (next ?? firstRef.current)?.focus();
  }, [stage, asking, firstRef]);
  const headingId = useId();

  if (stage === "done")
    return (
      <div className="card-file flex flex-col gap-4" ref={doneRef}>
        <p role="status" className="m-0" data-testid="card-file-done">
          {count === 0
            ? c.doneNothing(cardName)
            : count < previewed
              ? c.doneDiff(count, previewed - count, cardName)
              : c.done(count, cardName)}
        </p>
        {askBalance.map((a) => (
          <BalanceField
            key={a.key}
            account={a}
            onSave={async (value) => {
              await onSaveBalance?.(a.key, value);
              setSavedBalance(true);
              setAskBalance((l) => l.filter((x) => x.key !== a.key));
            }}
            onSkip={() => {
              setAskBalance((l) => l.filter((x) => x.key !== a.key));
            }}
          />
        ))}
        {savedBalance && (
          <p role="status" className="m-0 text-muted" data-testid="balance-saved">
            {c.balanceSaved}
          </p>
        )}
        <div className="ui-dialog-actions card-file-actions">
          <Button ref={firstRef} variant="primary" className="min-h-[44px]" onClick={onClose}>
            {c.doneClose}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="card-file flex flex-col gap-4" aria-busy={reading > 0 || stage === "adding"}>
      <details className="toonmeer toonmeer-regel" open={previews.length === 0}>
        <summary className="toonmeer-summary" id={headingId}>
          <span className="toonmeer-label">{c.stepsHeading}</span>
        </summary>
        <div className="toonmeer-panel">
          <p className="m-0 mb-2 font-semibold">{guide.where}</p>
          <ol className="m-0 pl-5 flex flex-col gap-1" data-testid="guide-steps">
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {phone && guide.phoneNote && (
            <p className="m-0 mt-2 text-muted" data-testid="phone-note">
              {guide.phoneNote}
            </p>
          )}
        </div>
      </details>

      <div
        className="border border-dashed border-line rounded p-4 flex flex-col items-start gap-2"
        data-dragging={dragging}
        style={dragging ? { borderColor: "var(--accent)" } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files);
        }}
      >
        <p className="m-0 text-muted text-[0.9rem] hidden [@media(pointer:fine)]:block">
          {c.dropHint}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label={c.chooseButton}
          data-testid="card-file-input"
          accept=".csv,.xlsx,.940,.sta,.txt,.mt940,text/csv"
          onChange={(e) => {
            const files = e.target.files;
            if (files) void take(files);
            e.target.value = "";
          }}
        />
        <Button
          ref={firstRef}
          variant="primary"
          className="min-h-[44px]"
          disabled={stage === "adding"}
          onClick={() => inputRef.current?.click()}
        >
          {c.chooseButton}
        </Button>
        <span className="text-muted text-[0.85rem]">{c.typesHint}</span>
      </div>

      <div role="status" className="m-0">
        {reading > 0 ? c.reading : null}
      </div>

      {previews.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {previews.map((pv) => (
            <PreviewCard
              key={pv.id}
              preview={pv}
              plan={plans.get(pv.id)}
              cardName={card?.name ?? null}
              overridden={override.has(pv.id)}
              sameAnswer={same.get(pv.id)}
              onAnswer={(v) => setSame((m) => new Map(m).set(pv.id, v))}
              onOverride={() => setOverride((s) => new Set(s).add(pv.id))}
              onRemove={() => setPreviews((l) => l.filter((x) => x.id !== pv.id))}
              disabled={stage === "adding"}
            />
          ))}
        </ul>
      )}

      {failed && (
        <StatusLine tone="problem" role="alert">
          {failed === "partial" ? c.failedPartial : c.failed}
        </StatusLine>
      )}

      <div className="ui-dialog-actions card-file-actions">
        <Button onClick={onClose} disabled={stage === "adding"} className="min-h-[44px]">
          {c.cancel}
        </Button>
        <Button
          variant="primary"
          className="min-h-[44px]"
          disabled={!somethingNew || reading > 0 || stage === "adding"}
          onClick={() => void add()}
        >
          {stage === "adding" ? c.adding : c.add}
        </Button>
      </div>
    </div>
  );
}

function PreviewCard(p: {
  preview: FilePreview;
  plan: CardFilePlan | undefined;
  cardName: string | null;
  overridden: boolean;
  sameAnswer: boolean | undefined;
  onAnswer: (same: boolean) => void;
  onOverride: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [locale] = useAppLocale();
  const c = cardFileCopy[locale];
  const { preview: pv, plan } = p;
  return (
    <li className="border border-line rounded p-3" data-testid="file-preview">
      <div className="flex items-start justify-between gap-2">
        <strong className="break-all">{pv.name}</strong>
        <button
          type="button"
          className="widget-hide flex-none"
          style={{ opacity: 1, minWidth: 44, minHeight: 44 }}
          aria-label={c.removeFile(pv.name)}
          title={c.removeFile(pv.name)}
          disabled={p.disabled}
          onClick={p.onRemove}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {pv.result === null || plan === undefined ? (
        <StatusLine tone="problem" role="alert">
          {pv.reason === "xls" ? c.xls : c.unreadableFile}
        </StatusLine>
      ) : plan.problems.length > 0 ? (
        <StatusLine tone="problem" role="alert">
          {plan.problems.map((x) => c.problem(x)).join(" ")}
        </StatusLine>
      ) : plan.txCount === 0 ? (
        <StatusLine tone="problem" role="alert">
          {c.noTransactions}
        </StatusLine>
      ) : (
        <div className="mt-1 flex flex-col gap-1">
          {plan.question !== null ? null : plan.newCount > 0 ? (
            <>
              <div className="font-semibold">{c.newLine(plan.newCount)}</div>
              <div className="text-muted text-[0.85rem]">
                {c.metaLine(
                  plan.duplicateCount,
                  plan.period ? formatPeriod(locale, plan.period.from, plan.period.to) : "",
                  plan.source,
                )}
              </div>
            </>
          ) : (
            <div className="font-semibold">{c.nothingNew(plan.txCount)}</div>
          )}
          {plan.destination && plan.question === null && (
            <div className="text-muted text-[0.85rem]" data-testid="destination">
              {plan.destination.existing
                ? c.goesTo(plan.destination.name)
                : c.goesToNew(plan.destination.name)}
            </div>
          )}
          {plan.question && (
            <div role="group" aria-label={c.question(plan.question.accountName)} className="flex flex-col gap-2" data-testid="same-card-question">
              <div>{c.question(plan.question.accountName)}</div>
              <Button className="self-start min-h-[44px]" disabled={p.disabled} onClick={() => p.onAnswer(true)}>
                {c.questionYes(plan.question.accountName)}
              </Button>
              <Button className="self-start min-h-[44px]" disabled={p.disabled} onClick={() => p.onAnswer(false)}>
                {c.questionNo}
              </Button>
            </div>
          )}
          {plan.unreadable > 0 && (
            <StatusLine tone="warning" role="status">
              {c.unreadableRows(plan.unreadable)}
            </StatusLine>
          )}
          {plan.unrecognised.length > 0 && (
            <StatusLine tone="warning" role="status">
              {c.unrecognisedLine(plan.unrecognised)}
            </StatusLine>
          )}
          {plan.noCardPayments && (
            <StatusLine tone="warning" role="status">
              {c.noCardPayments}
            </StatusLine>
          )}
          {plan.unmatchedExisting && (
            <StatusLine tone="warning" role="status">
              {c.unmatchedExisting}
            </StatusLine>
          )}
          {!pv.matchesCard && p.cardName !== null && (
            <>
              <StatusLine tone="problem" role="alert">
                {c.wrongIssuer(p.cardName, plan.source)}
              </StatusLine>
              {p.overridden ? (
                <div role="status">{c.continueAnywayDone}</div>
              ) : (
                <Button
                  className="self-start min-h-[44px]"
                  disabled={p.disabled}
                  onClick={p.onOverride}
                >
                  {c.continueAnyway}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** One optional balance question for an account the import wrote without a balance.
 *  A credit card is asked as the amount owed (typed positive; the existing path
 *  stores the debt as a negative). The date is today: the existing path anchors
 *  `balanceDate` to today, so there is no date control. */
function BalanceField(p: {
  account: Account;
  onSave: (value: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [locale] = useAppLocale();
  const c = cardFileCopy[locale];
  const id = useId();
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const a = p.account;
  const credit = balanceAskKind(a) === "owed";
  const t212Card = a.statedCardId !== undefined && !credit;
  const label = credit ? c.balanceCredit : t212Card ? c.balanceDebit : c.balanceOther(a.name);
  const helper = credit
    ? /american express|amex/i.test(a.bank)
      ? c.helperAmex
      : c.helperCredit
    : t212Card && /trading\s*212/i.test(a.bank)
      ? c.helperT212
      : c.helperOther;

  async function submit() {
    if (draft.trim() === "") return p.onSkip();
    const n = parseBalanceReply(draft);
    if (n === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setFailed(false);
    setSaving(true);
    try {
      await p.onSave(String(n));
    } catch {
      // Keep what was typed and let the user try again; nothing was stored.
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="border border-line rounded p-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        data-testid="balance-input"
        inputMode="decimal"
        autoComplete="off"
        className="saldo-input w-full min-h-[44px] text-right tabular-nums"
        value={draft}
        aria-describedby={`${id}-h`}
        aria-invalid={bad}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div id={`${id}-h`} className="text-muted text-[0.85rem]">
        <div>{helper}</div>
        <div>{c.perToday}</div>
      </div>
      {bad && (
        <StatusLine tone="problem" role="alert">
          {c.notAmount}
        </StatusLine>
      )}
      {failed && (
        <StatusLine tone="problem" role="alert">
          {c.balanceFailed}
        </StatusLine>
      )}
      <div className="flex gap-2 flex-wrap">
        <Button type="submit" variant="primary" className="min-h-[44px]" disabled={saving}>
          {c.save}
        </Button>
        <Button className="min-h-[44px]" disabled={saving} onClick={p.onSkip}>
          {c.skip}
        </Button>
      </div>
    </form>
  );
}
