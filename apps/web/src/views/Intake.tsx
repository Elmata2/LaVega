import { useMemo, useState } from "react";
import {
  computeRoom,
  resolveRoom,
  type Account,
  type AdvisorProfile,
  type AdvisorProfileStore,
  type EntityProfile,
  type OwnAccounts,
  type Rule,
  type Tx,
} from "@lavega/core";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { useAppLocale } from "../appLocale.js";
import type { View } from "../appRoutes.js";
import { intakeCopy } from "../copy/intake.js";
import type { Locale } from "../locale.js";
import type { ConversionMode, OwnerName } from "../settings.js";
import Block1 from "../intake/Block1.js";
import Block2 from "../intake/Block2.js";
import Block3 from "../intake/Block3.js";
import { inferBlock1 } from "../intake/inference.js";
import { completeBlock, markStep0, resumeStage, type Stage } from "../intake/state.js";
import Step0 from "../intake/Step0.js";
import { useProfileCommit } from "../intake/useProfileCommit.js";
import RoomPayoff, { blockingInfoOf } from "../intake/RoomPayoff.js";

export type IntakeProps = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  profiles: EntityProfile[];
  /** Today, `YYYY-MM-DD`. */
  asOf: string;
  mode: ConversionMode;
  fxHistory: Record<string, Record<string, number>>;
  /** What the vault holds; null when it holds nothing readable. */
  store: AdvisorProfileStore | null;
  /** True when a stored profile exists but no longer decodes. */
  corrupt?: boolean;
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onNavigate: (view: View) => void;
  /* Step 0 reuses the Import card, so it needs what Profiel passes it. */
  busy: boolean;
  entity: string;
  onEntityChange: (entity: string) => void;
  onImport: (file: File) => void | Promise<void>;
  onRefreshBank: () => void;
  homeCountry: string;
  onHomeCountryChange: (code: string) => void;
  homeRegion: string;
  ownerName: OwnerName;
  onOwnerNameChange: (name: OwnerName) => void;
  onHomeRegionChange: (region: string) => void;
  /** The write time for the store, injectable for tests. */
  now?: () => string;
};

const STEP_NUMBER: Record<Exclude<Stage, "done">, number> = {
  step0: 1,
  block1: 2,
  block2: 3,
  block3: 4,
};

/** The profile intake: step 0 (data), block 1 (confirm what we found, then the
 *  room payoff), block 2 (what data cannot show), block 3 (risk and knowledge).
 *  Every answer is saved as it is given, so closing the tab loses nothing and
 *  reopening resumes at the first unfinished block. */
export default function Intake(props: IntakeProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale];
  const now = props.now ?? (() => new Date().toISOString());

  const { store, commit, update, saveFailed, setSaveFailed } = useProfileCommit(
    props.store,
    props.onSave,
    now,
  );
  const [stage, setStage] = useState<Stage>(() => resumeStage(store.current));
  const [saidChildren, setSaidChildren] = useState(false);
  const profile = store.current;

  const inference = useMemo(
    () =>
      inferBlock1({
        accounts: props.accounts,
        txs: props.txs,
        rules: props.rules,
        own: props.own,
        profiles: props.profiles,
        asOf: props.asOf,
        profile,
      }),
    [props.accounts, props.txs, props.rules, props.own, props.profiles, props.asOf, profile],
  );
  const computedRoom = useMemo(
    () =>
      computeRoom({
        txs: props.txs,
        accounts: props.accounts,
        profiles: props.profiles,
        rules: props.rules,
        own: props.own,
        asOf: props.asOf,
        mode: props.mode,
        fxHistory: props.fxHistory,
      }),
    [
      props.txs,
      props.accounts,
      props.profiles,
      props.rules,
      props.own,
      props.asOf,
      props.mode,
      props.fxHistory,
    ],
  );

  async function choose(choice: "bank" | "upload" | "none") {
    try {
      await commit((p) => markStep0(p, choice));
    } catch (e) {
      setSaveFailed(true);
      // The bank redirect must not happen if the place was not saved.
      if (choice === "bank") throw e;
      return;
    }
    if (choice !== "bank") setStage("block1");
  }

  async function finishBlock(block: 1 | 2, next: Stage) {
    if (await update((p) => completeBlock(p, block))) setStage(next);
  }

  return (
    <div aria-label={c.ariaLabel} role="region" className="max-w-[48rem]">
      {props.corrupt && (
        <p role="status" className="text-warn">
          {c.corruptNotice}
        </p>
      )}
      {stage !== "done" && (
        <p className="text-muted text-[0.85rem]" data-testid="intake-progress">
          {c.progress(STEP_NUMBER[stage], 4, c.stages[stage])}
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="text-warn">
          {c.saveFailed}
        </p>
      )}

      {stage === "step0" && (
        <Step0
          copy={c}
          locale={locale}
          accounts={props.accounts}
          txs={props.txs}
          busy={props.busy}
          entity={props.entity}
          onEntityChange={props.onEntityChange}
          onImport={props.onImport}
          onRefreshBank={props.onRefreshBank}
          homeCountry={props.homeCountry}
          onHomeCountryChange={props.onHomeCountryChange}
          homeRegion={props.homeRegion}
          ownerName={props.ownerName}
          onOwnerNameChange={props.onOwnerNameChange}
          onHomeRegionChange={props.onHomeRegionChange}
          onChoose={choose}
        />
      )}
      {stage === "block1" && (
        <Block1
          copy={c}
          locale={locale}
          asOf={props.asOf}
          busy={props.busy}
          profile={profile}
          inference={inference}
          accounts={props.accounts}
          txs={props.txs}
          computedRoom={computedRoom}
          update={update}
          childYes={saidChildren}
          onChildYes={() => setSaidChildren(true)}
          onDone={() => void finishBlock(1, "block2")}
        />
      )}
      {stage === "block2" && (
        <Block2
          copy={c}
          locale={locale}
          asOf={props.asOf}
          profile={profile}
          saidChildren={saidChildren}
          update={update}
          onDone={() => void finishBlock(2, "block3")}
        />
      )}
      {stage === "block3" && (
        <Block3
          copy={c}
          locale={locale}
          asOf={props.asOf}
          profile={profile}
          computedRoom={computedRoom}
          update={update}
          onDone={() => setStage("done")}
        />
      )}
      {stage === "done" && (
        <>
          <Card as="section" aria-label={c.done.title}>
            <h2>{c.done.title}</h2>
            <p>{c.done.body}</p>
            <Button variant="primary" onClick={() => props.onNavigate("overview")}>
              {c.done.toOverview}
            </Button>
          </Card>
          <RoomRecap
            copy={c}
            locale={locale}
            computedRoom={computedRoom}
            profile={profile}
            accounts={props.accounts}
          />
        </>
      )}

      <p className="text-muted text-[0.85rem] mt-4">{c.legalLine}</p>
    </div>
  );
}

function RoomRecap({
  copy,
  locale,
  computedRoom,
  profile,
  accounts,
}: {
  accounts: Account[];
  copy: (typeof intakeCopy)["nl"];
  locale: Locale;
  computedRoom: Parameters<typeof resolveRoom>[0];
  profile: AdvisorProfile;
}) {
  const { room, statedInputs } = resolveRoom(computedRoom, profile);
  return (
    <RoomPayoff
      copy={copy}
      locale={locale}
      room={room}
      blocking={blockingInfoOf(room, accounts, copy.payoff.anAccount)}
      {...(statedInputs ? { statedInputs } : {})}
      hideContinue
      onContinue={() => {}}
    />
  );
}
