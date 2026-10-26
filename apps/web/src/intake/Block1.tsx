import { useMemo, useState } from "react";
import type { Account, AdvisorProfile, Tx } from "@lavega/core";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import type { IntakeCopy } from "../copy/intake.js";
import { formatCurrencyIn, formatDate, formatWholeEuroIn } from "../format.js";
import type { Locale } from "../locale.js";
import { withLenderLabel, type Block1Inference } from "./inference.js";
import ProposalCard from "./ProposalCard.js";
import RoomPayoff, { blockingInfoOf } from "./RoomPayoff.js";
import {
  applyChildren,
  applyProposalAnswer,
  applyStatedHousing,
  applyStatedRange,
  applyStatedSavings,
  resolveRoom,
  statusOf,
  type CardProposal,
} from "./state.js";
import { StatedHousingCard, StatedRangeCard, StatedSavingsCard } from "./StatedCards.js";
import type { RoomResult } from "@lavega/core";

const MAX_EVIDENCE = 12;

type Props = {
  copy: IntakeCopy;
  locale: Locale;
  asOf: string;
  busy: boolean;
  profile: AdvisorProfile;
  inference: Block1Inference;
  accounts: Account[];
  txs: Tx[];
  computedRoom: RoomResult;
  update: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<boolean>;
  childYes: boolean;
  onChildYes: () => void;
  onDone: () => void;
};

export default function Block1(p: Props) {
  const { copy: c, locale, inference: inf, profile } = p;
  const [phase, setPhase] = useState<"cards" | "payoff">("cards");
  const txById = useMemo(() => new Map(p.txs.map((t) => [t.id, t])), [p.txs]);
  const accountByKey = useMemo(() => new Map(p.accounts.map((a) => [a.key, a])), [p.accounts]);
  const eur = (cents: number) => formatWholeEuroIn(locale, cents / 100);
  const s = c.block1.sentences;

  if (p.busy) return <p role="status">{c.loading}</p>;

  if (phase === "payoff") {
    const { room, statedInputs } = resolveRoom(p.computedRoom, profile);
    return (
      <RoomPayoff
        copy={c}
        locale={locale}
        room={room}
        blocking={blockingInfoOf(room, p.accounts, c.payoff.anAccount)}
        {...(statedInputs ? { statedInputs } : {})}
        onContinue={p.onDone}
      />
    );
  }

  function evidence(proposal: CardProposal): { lines: string[]; total: number } {
    const rows: { date: string; text: string }[] = [];
    for (const id of proposal.evidence) {
      if (id.startsWith("account:")) {
        const a = accountByKey.get(id.slice("account:".length));
        if (a) rows.push({ date: "", text: c.block1.accountEvidence(a.name || a.bank) });
        continue;
      }
      const t = txById.get(id);
      if (!t) continue;
      rows.push({
        date: t.date,
        text: `${formatDate(locale, t.date)} – ${t.counterparty || t.description} – ${formatCurrencyIn(locale, t.amount, t.currency)}`,
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return {
      lines: rows.slice(0, MAX_EVIDENCE).map((r) => r.text),
      total: proposal.evidence.length,
    };
  }

  function sentenceFor(proposal: CardProposal): string {
    if (proposal.kind === "income" && "regularity" in proposal.data) {
      const d = proposal.data;
      return d.regularity === "regular"
        ? s.incomeRegular(d.label, eur(d.monthlyCents))
        : s.incomeIrregular(d.label, eur(d.monthlyCents));
    }
    if (proposal.kind === "debt") {
      const d = proposal.data;
      return d.origin === "creditCard"
        ? s.debtCard(d.lender, eur(d.balanceCents ?? 0))
        : s.debtStream(d.lender, eur(d.monthlyCents ?? 0));
    }
    if ("housingKind" in proposal.data) {
      const d = proposal.data;
      return s.housing(s.housingKinds[d.housingKind], d.counterparty, eur(d.monthlyCents));
    }
    if ("origin" in proposal.data) {
      const d = proposal.data;
      return d.origin === "subscription"
        ? s.fixedSubscription(d.label, eur(d.monthlyCents))
        : s.fixedStream(d.label, eur(d.monthlyCents));
    }
    const d = proposal.data as { totalCents: number; excluded: number };
    return (
      s.savings(eur(d.totalCents)) + (d.excluded > 0 ? ` ${s.savingsExcluded(d.excluded)}` : "")
    );
  }

  function figureOf(proposal: CardProposal): number {
    if (proposal.kind === "debt") return proposal.data.monthlyCents ?? 0;
    if ("totalCents" in proposal.data) return proposal.data.totalCents;
    return (proposal.data as { monthlyCents: number }).monthlyCents;
  }

  const card = (raw: CardProposal) => {
    const proposal =
      raw.kind === "debt" ? withLenderLabel(raw, p.accounts, c.payoff.anAccount) : raw;
    const ev = evidence(proposal);
    return (
      <ProposalCard
        key={proposal.id}
        copy={c}
        sentence={sentenceFor(proposal)}
        evidenceLines={ev.lines}
        evidenceTotal={ev.total}
        evidenceSummary={
          proposal.evidence.every((id) => id.startsWith("account:"))
            ? c.block1.accountsEvidence(ev.total)
            : c.block1.evidence(ev.total)
        }
        status={statusOf(profile, proposal)}
        figureCents={figureOf(proposal)}
        onAnswer={(answer) =>
          void p.update((pr) => applyProposalAnswer(pr, proposal, answer, p.asOf))
        }
      />
    );
  };

  const st = c.block1.stated;
  const usable = inf.coverage.sufficient;
  const incomeNote = !inf.hasTxs
    ? c.block1.noData
    : !usable
      ? c.block1.thinData(inf.coverage.days)
      : undefined;
  const ranges = profile.statedRanges?.value;
  const housing = profile.housing;
  const rangeSummary = (r: { lowCents: number; highCents: number }) =>
    st.range(eur(r.lowCents), eur(r.highCents));

  const incomeStated = (
    <StatedRangeCard
      key="stated-income"
      copy={c}
      title={st.incomeTitle}
      question={st.incomeQuestion}
      {...(incomeNote === undefined ? {} : { note: incomeNote })}
      initial={ranges?.income}
      summary={rangeSummary}
      onSave={(r) => void p.update((pr) => applyStatedRange(pr, "income", r, p.asOf))}
    />
  );
  const housingStated = (
    <StatedHousingCard
      key="stated-housing"
      copy={c}
      initial={housing?.source === "stated" ? housing.value : undefined}
      summary={(v) => `${st.housingKinds[v.kind]}, ${eur(v.monthlyCents)}`}
      onSave={(kind, cents) => void p.update((pr) => applyStatedHousing(pr, kind, cents, p.asOf))}
    />
  );
  const savingsStated = (
    <StatedSavingsCard
      key="stated-savings"
      copy={c}
      initialCents={
        profile.savings?.source === "stated" ? profile.savings.value.totalCents : undefined
      }
      summary={eur}
      onSave={(cents) => void p.update((pr) => applyStatedSavings(pr, cents, p.asOf))}
    />
  );

  const child = inf.child;
  const children = profile.children?.value;

  return (
    <>
      <Card as="section" aria-label={c.block1.title}>
        <h2>{c.block1.title}</h2>
        <p className="text-muted text-[0.85rem]">{c.block1.intro}</p>
      </Card>

      <h3>{c.block1.sections.income}</h3>
      {usable && inf.income.length > 0 ? inf.income.map(card) : incomeStated}
      {!usable && (
        <StatedRangeCard
          copy={c}
          title={st.spendTitle}
          question={st.spendQuestion}
          initial={ranges?.spend}
          summary={rangeSummary}
          onSave={(r) => void p.update((pr) => applyStatedRange(pr, "spend", r, p.asOf))}
        />
      )}

      <h3>{c.block1.sections.housing}</h3>
      {usable && inf.housing ? card(inf.housing) : housingStated}

      {usable && inf.fixed.length > 0 && (
        <>
          <h3>{c.block1.sections.fixed}</h3>
          {inf.fixed.map(card)}
        </>
      )}
      {usable && inf.debts.length > 0 && (
        <>
          <h3>{c.block1.sections.debts}</h3>
          {inf.debts.map(card)}
        </>
      )}

      <h3>{c.block1.sections.savings}</h3>
      {inf.savings ? card(inf.savings) : savingsStated}

      {child && (
        <>
          <h3>{c.block1.sections.children}</h3>
          <Card as="article" data-testid="child-card" className="mb-[var(--sp-3)]">
            <p className="text-muted m-0">{c.block1.weThink}</p>
            <p className="m-0 mt-1">
              {child.kind === "kinderbijslag"
                ? c.block1.child.kinderbijslag
                : c.block1.child.childcare}{" "}
              {c.block1.child.question}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-muted">
                {c.block1.evidence(child.evidence.length)}
              </summary>
              <ul className="mt-2 list-none p-0">
                {child.evidence.slice(0, MAX_EVIDENCE).map((id) => {
                  const t = txById.get(id);
                  return t ? (
                    <li key={id} className="text-muted text-[0.85rem]">
                      {formatDate(locale, t.date)} – {t.counterparty || t.description} –{" "}
                      {formatCurrencyIn(locale, t.amount, t.currency)}
                    </li>
                  ) : null;
                })}
              </ul>
            </details>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={p.onChildYes} aria-pressed={p.childYes}>
                {c.common.yes}
              </Button>
              <Button onClick={() => void p.update((pr) => applyChildren(pr, [], p.asOf))}>
                {c.common.no}
              </Button>
              {(p.childYes || (children && children.length > 0)) && (
                <span className="text-muted">{c.block1.child.yesNote}</span>
              )}
              {children && children.length === 0 && !p.childYes && (
                <span className="text-muted">{c.block1.child.noNote}</span>
              )}
            </div>
          </Card>
        </>
      )}

      <div className="mt-4">
        <Button variant="primary" onClick={() => setPhase("payoff")}>
          {c.block1.continueToRoom}
        </Button>
      </div>
    </>
  );
}
