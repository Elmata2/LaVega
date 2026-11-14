import { useEffect, useRef, useState } from "react";
import type { Account, AdvisorProfileStore } from "@lavega/core";
import type { View } from "../App";
import { useAppLocale } from "../appLocale.js";
import { intakeCopy } from "../copy/intake.js";
import { wizardCopy } from "../copy/wizard.js";
import { inviteKindOf, inviteState, type InviteState } from "../intake/inviteState.js";
import { unconnectedBrands } from "../intake/unconnectedBrands.js";
import { useProfileCommit } from "../intake/useProfileCommit.js";
import { reopenRisk } from "../intake/wizard/screens.js";
import {
  markShownThisSession,
  nextPopup,
  readDismissed,
  wasShownThisSession,
  writeDismissed,
  type PopupId,
} from "../lib/popups.js";
import Button from "./ui/Button.js";
import Dialog from "./ui/Dialog.js";

export type HomePopupsProps = {
  view: View;
  /** A banner, the empty-scope line or an overlay owns the screen. */
  blocked: boolean;
  store: AdvisorProfileStore | null;
  /** False while the profile is loading or errored: nothing opens. */
  profileReady: boolean;
  asOf: string;
  hasTransactions: boolean;
  accounts: readonly Pick<Account, "bank" | "linkedAt">[];
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onOpenIntake: () => void;
  onOpenRound2: () => void;
  onOpenAccounts: () => void;
  now?: () => string;
};

/* What the open dialog shows, fixed at the moment it opened: a risk save
 * changes the store under it, and the text must not change with it. */
type Shown = { id: PopupId; invite: InviteState | null; brands: string[] };

const clock = () => new Date().toISOString();

/* At most one pop-up per session, on the overview only, one frame after mount.
 * The session mark is written in the callback that opens it, so a remount or
 * StrictMode's second effect finds it set. */
export function HomePopups(props: HomePopupsProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale].home;
  const names = wizardCopy[locale].bankNames;
  const now = props.now ?? clock;
  const { update } = useProfileCommit(props.store, props.onSave, now);
  const [shown, setShown] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  /* Whether the dialog is open right now, for a save that finishes later: a
   * dismissal, a view change or a block while it ran must not open the wizard. */
  const stillOpen = useRef(false);
  const latest = useRef({ ...props, now });
  useEffect(() => {
    latest.current = { ...props, now };
  });

  const { view, blocked, profileReady } = props;
  useEffect(() => {
    if (shown !== null || !profileReady) return;
    const frame = requestAnimationFrame(() => {
      const p = latest.current;
      const invite = inviteState(p.store, p.asOf, p.hasTransactions);
      const brands = unconnectedBrands(p.store, p.accounts);
      const id = nextPopup({
        view: p.view,
        inviteKind: inviteKindOf(invite),
        unconnectedCount: brands.length,
        dismissed: readDismissed(),
        shownThisSession: wasShownThisSession(),
        blocked: p.blocked,
        now: p.now(),
      });
      if (id === null) return;
      markShownThisSession();
      setShown({ id, invite, brands });
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, profileReady, view, blocked]);

  // The page changed under an open dialog: close it, no dismissal. The session
  // mark stays, so it does not come back this session.
  if (open && (view !== "overview" || blocked)) setOpen(false);
  useEffect(() => {
    stillOpen.current = open && view === "overview" && !blocked;
  });

  if (shown === null) return null;

  const dismiss = () => {
    if (!open) return;
    writeDismissed(shown.id, now());
    setOpen(false);
  };
  const go = (action: () => void) => {
    setOpen(false);
    action();
  };

  const later = <Button onClick={dismiss}>{c.later}</Button>;
  const primary = (label: string, onClick: () => void) => (
    <Button ref={primaryRef} variant="primary" onClick={onClick}>
      {label}
    </Button>
  );

  let heading: string;
  let body: React.ReactNode;
  let action: React.ReactNode;
  const i = c.invite;
  const invite = shown.invite;
  if (shown.id === "connect") {
    heading = c.connect.title;
    body = (
      <ul className="m-0 list-none p-0">
        {shown.brands.map((b) => (
          <li key={b} className="py-1">
            {c.connect.line(names[b] ?? b)}
          </li>
        ))}
      </ul>
    );
    action = primary(c.connect.link, () => go(props.onOpenAccounts));
  } else if (invite?.kind === "new-questions") {
    heading = i.newQuestions.title;
    body = <p className="m-0">{i.newQuestions.count(invite.count)}</p>;
    action = primary(i.start, () => go(props.onOpenIntake));
  } else if (invite?.kind === "round2") {
    heading = i.round2.title;
    body = <p className="m-0">{i.round2.count(invite.count)}</p>;
    action = primary(i.start, () => go(props.onOpenRound2));
  } else {
    const due = invite?.kind === "intake" && invite.riskDue;
    const resuming = due || (invite?.kind === "intake" && invite.resumeAt !== null);
    heading = i.title;
    body = (
      <>
        <p className="m-0">{i.intro}</p>
        {resuming && <p className="text-muted text-[0.85rem]">{due ? i.riskDue : i.resumed}</p>}
      </>
    );
    action = primary(resuming ? i.resume : i.start, () => {
      if (!due) return go(props.onOpenIntake);
      // Same mechanism as "Redo these questions": the risk screens reopen, answers stay.
      if (saving.current) return;
      saving.current = true;
      void update(reopenRisk)
        .then((saved) => {
          if (saved && stillOpen.current) go(props.onOpenIntake);
        })
        .finally(() => {
          saving.current = false;
        });
    });
  }

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title={heading}
      closeLabel={c.closeDialog}
      initialFocusRef={primaryRef}
      actions={
        <>
          {later}
          {action}
        </>
      }
    >
      {body}
    </Dialog>
  );
}
