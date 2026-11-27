import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import {
  balanceAskKind,
  parseBalanceReply,
  planCardFiles,
  type Account,
  type CardFileInput,
  type CardFilePlan,
  type Tx,
  hasStatedCatalogueCard,
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
import { Dialog } from "@lavega/ui";
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
          <Body key={card?.id ?? OTHER} {...p} card={card} firstRef={firstRef} onBusy={setBusy} />
        ))}
    </Dialog>
  );
}

function Choice(p: {
  choices: readonly CardTarget[];
  onPick: (v: CardTarget | typeof OTHER) => void;
  firstRef: React.RefObject<HTMLButtonElement | null>;
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

type BodyStage =
  | { kind: "form"; failed: "none" | "partial" | null; failedFold: boolean }
  | { kind: "adding"; previewed: number; failedFold: boolean }
  | {
      kind: "done";
      count: number;
      previewed: number;
      askBalance: Account[];
      savedBalance: boolean;
    };

type BodyState = {
  previews: FilePreview[];
  override: Set<string>;
  same: Map<string, boolean>;
  reading: number;
  dragging: boolean;
  stage: BodyStage;
};

type BodyAction =
  | { type: "read-start"; count: number }
  | { type: "read-file"; preview: FilePreview }
  | { type: "set-dragging"; dragging: boolean }
  | { type: "set-same"; id: string; value: boolean }
  | { type: "set-override"; id: string }
  | { type: "remove-preview"; id: string }
  | { type: "add-start"; previewed: number; failedFold: boolean }
  | { type: "add-done"; count: number; askBalance: Account[] }
  | { type: "add-failed"; failed: "none" | "partial" }
  | { type: "balance-saved"; key: string }
  | { type: "balance-skipped"; key: string };

const INITIAL_BODY_STATE: BodyState = {
  previews: [],
  override: new Set(),
  same: new Map(),
  reading: 0,
  dragging: false,
  stage: { kind: "form", failed: null, failedFold: false },
};

function bodyReducer(state: BodyState, action: BodyAction): BodyState {
  switch (action.type) {
    case "read-start":
      return {
        ...state,
        reading: state.reading + action.count,
        stage:
          state.stage.kind === "form"
            ? { ...state.stage, failed: null }
            : state.stage,
      };
    case "read-file":
      return {
        ...state,
        previews: [...state.previews, action.preview],
        reading: Math.max(0, state.reading - 1),
      };
    case "set-dragging":
      return state.dragging === action.dragging ? state : { ...state, dragging: action.dragging };
    case "set-same": {
      const next = new Map(state.same);
      next.set(action.id, action.value);
      return { ...state, same: next };
    }
    case "set-override": {
      const next = new Set(state.override);
      next.add(action.id);
      return { ...state, override: next };
    }
    case "remove-preview":
      return {
        ...state,
        previews: state.previews.filter((x) => x.id !== action.id),
      };
    case "add-start":
      return {
        ...state,
        dragging: false,
        stage: {
          kind: "adding",
          previewed: action.previewed,
          failedFold: action.failedFold,
        },
      };
    case "add-done":
      return {
        ...state,
        stage: {
          kind: "done",
          count: action.count,
          previewed: state.stage.kind === "adding" ? state.stage.previewed : 0,
          askBalance: action.askBalance,
          savedBalance: false,
        },
      };
    case "add-failed":
      return {
        ...state,
        stage: {
          kind: "form",
          failed: action.failed,
          failedFold: state.stage.kind === "adding" ? state.stage.failedFold : false,
        },
      };
    case "balance-saved":
      return state.stage.kind === "done"
        ? {
            ...state,
            stage: {
              ...state.stage,
              savedBalance: true,
              askBalance: state.stage.askBalance.filter((x) => x.key !== action.key),
            },
          }
        : state;
    case "balance-skipped":
      return state.stage.kind === "done"
        ? {
            ...state,
            stage: {
              ...state.stage,
              askBalance: state.stage.askBalance.filter((x) => x.key !== action.key),
            },
          }
        : state;
  }
}

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
  firstRef: React.RefObject<HTMLButtonElement | null>;
  onBusy: (b: boolean) => void;
}) {
  const [locale] = useAppLocale();
  const c = cardFileCopy[locale];
  const guide = guideFor(card?.brand ?? null, locale);
  const phone = isPhone();
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const answeredRef = useRef(false);
  const mountedRef = useRef(true);
  const addingRef = useRef(false);
  const [state, dispatch] = useReducer(bodyReducer, INITIAL_BODY_STATE);
  const { previews, override, same, reading, dragging, stage } = state;
  const stageKindRef = useRef(stage.kind);
  useEffect(() => {
    stageKindRef.current = stage.kind;
  }, [stage.kind]);
  const cardName = card?.name ?? c.otherName;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function take(files: FileList | File[]) {
    if (stageKindRef.current === "adding" || addingRef.current) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    dispatch({ type: "read-start", count: list.length });
    for (const file of list) {
      seq += 1;
      const preview = await previewCardFile(file, { id: `f${seq}`, entity, card });
      if (!mountedRef.current) return;
      dispatch({ type: "read-file", preview });
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

  // The answered question's buttons unmount with focus on them, which drops focus
  // to the dialog body. Hand it to Toevoegen once nothing is left to answer, or to the close
  // button when there is nothing new to add.
  useEffect(() => {
    if (!answeredRef.current || pending) return;
    answeredRef.current = false;
    const add = addRef.current;
    if (add && !add.disabled) add.focus();
    else add?.closest("dialog")?.querySelector<HTMLElement>(".ui-dialog-close")?.focus();
  }, [pending, somethingNew]);

  async function add() {
    if (addingRef.current || stageKindRef.current === "adding") return;
    addingRef.current = true;
    const failedFold = writable.some((pv) => plans.get(pv.id)?.foldsExisting === true);
    const previewed = writable.reduce((n, pv) => n + (plans.get(pv.id)?.newCount ?? 0), 0);
    dispatch({ type: "add-start", previewed, failedFold });
    onBusy(true);
    try {
      const r = await onCommit(
        writable.map((pv) => toInput(pv, card, override.has(pv.id), same.get(pv.id))!),
        card,
      );
      if (!mountedRef.current) return;
      if (r.ok) {
        dispatch({
          type: "add-done",
          count: r.count,
          askBalance: onSaveBalance ? (r.written ?? []).filter((a) => a.balance === null) : [],
        });
        onDone?.(r.count);
      } else {
        dispatch({ type: "add-failed", failed: r.partial ? "partial" : "none" });
      }
    } catch {
      if (mountedRef.current) {
        dispatch({ type: "add-failed", failed: "partial" });
      }
    } finally {
      addingRef.current = false;
      onBusy(false);
    }
  }

  // Entering the success state: focus goes to the first balance field when there is
  // one, else to the Sluiten button; never to <body>.
  const doneRef = useRef<HTMLDivElement>(null);
  const asking = stage.kind === "done" ? stage.askBalance.length : 0;
  useEffect(() => {
    if (stage.kind !== "done") return;
    const next = doneRef.current?.querySelector<HTMLInputElement>("input");
    (next ?? firstRef.current)?.focus();
  }, [stage.kind, asking, firstRef]);
  const headingId = useId();

  if (stage.kind === "done")
    return (
      <div className="card-file flex flex-col gap-4" ref={doneRef}>
        <p role="status" className="m-0" data-testid="card-file-done">
          {stage.count === 0
            ? c.doneNothing(cardName)
            : stage.count < stage.previewed
              ? c.doneDiff(stage.count, stage.previewed - stage.count, cardName)
              : c.done(stage.count, cardName)}
        </p>
        {stage.askBalance.map((a) => (
          <BalanceField
            key={a.key}
            account={a}
            onSave={async (value) => {
              await onSaveBalance?.(a.key, value);
              if (mountedRef.current) dispatch({ type: "balance-saved", key: a.key });
            }}
            onSkip={() => {
              dispatch({ type: "balance-skipped", key: a.key });
            }}
          />
        ))}
        {stage.savedBalance && (
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

  const isAdding = stage.kind === "adding";
  const failed = stage.kind === "form" ? stage.failed : null;
  const failedFold = stage.kind === "form" ? stage.failedFold : false;

  return (
    <div className="card-file flex flex-col gap-4" aria-busy={reading > 0 || isAdding}>
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
          if (!isAdding) dispatch({ type: "set-dragging", dragging: true });
        }}
        onDragLeave={() => dispatch({ type: "set-dragging", dragging: false })}
        onDrop={(e) => {
          e.preventDefault();
          dispatch({ type: "set-dragging", dragging: false });
          if (isAdding) return;
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
          disabled={isAdding}
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
          disabled={isAdding}
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
              onAnswer={(v) => {
                answeredRef.current = true;
                dispatch({ type: "set-same", id: pv.id, value: v });
              }}
              onOverride={() => dispatch({ type: "set-override", id: pv.id })}
              onRemove={() => dispatch({ type: "remove-preview", id: pv.id })}
              disabled={isAdding}
            />
          ))}
        </ul>
      )}

      {failed && (
        <StatusLine tone="problem" role="alert">
          {failed === "partial" ? (failedFold ? c.failedPartialFold : c.failedPartial) : c.failed}
        </StatusLine>
      )}

      <div className="ui-dialog-actions card-file-actions">
        <Button onClick={onClose} disabled={isAdding} className="min-h-[44px]">
          {c.cancel}
        </Button>
        <Button
          ref={addRef}
          variant="primary"
          className="min-h-[44px]"
          disabled={!somethingNew || reading > 0 || isAdding}
          onClick={() => void add()}
        >
          {isAdding ? c.adding : c.add}
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
            <div
              role="group"
              aria-label={c.question(plan.question.accountName)}
              className="flex flex-col gap-2"
              data-testid="same-card-question"
            >
              <div>{c.question(plan.question.accountName)}</div>
              <Button
                className="self-start min-h-[44px]"
                disabled={p.disabled}
                onClick={() => p.onAnswer(true)}
              >
                {c.questionYes(plan.question.accountName)}
              </Button>
              <Button
                className="self-start min-h-[44px]"
                disabled={p.disabled}
                onClick={() => p.onAnswer(false)}
              >
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
          {plan.foldBlocked && (
            <StatusLine tone="warning" role="status">
              {c.foldBlocked}
            </StatusLine>
          )}
          {plan.foldsExisting && (
            <StatusLine tone="warning" role="status">
              {c.foldsExisting}
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
  const [status, setStatus] = useState<"idle" | "invalid" | "saving" | "failed">("idle");
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const bad = status === "invalid";
  const failed = status === "failed";
  const saving = status === "saving";
  const a = p.account;
  const credit = balanceAskKind(a) === "owed";
  const t212Card = hasStatedCatalogueCard(a) && !credit;
  const label = credit ? c.balanceCredit : t212Card ? c.balanceDebit : c.balanceOther(a.name);
  const helper = credit
    ? /american express|amex/i.test(a.bank)
      ? c.helperAmex
      : c.helperCredit
    : t212Card && /trading\s*212/i.test(a.bank)
      ? c.helperT212
      : c.helperOther;

  async function submit() {
    if (savingRef.current) return;
    if (draft.trim() === "") return p.onSkip();
    const n = parseBalanceReply(draft);
    if (n === null) {
      setStatus("invalid");
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      await p.onSave(String(n));
    } catch {
      if (mountedRef.current) setStatus("failed");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        setStatus((cur) => (cur === "saving" ? "idle" : cur));
      }
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
        onChange={(e) => {
          setDraft(e.target.value);
          if (status === "invalid" || status === "failed") setStatus("idle");
        }}
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
