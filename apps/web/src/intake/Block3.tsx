import { useState } from "react";
import {
  KNOWLEDGE_QUESTIONS,
  RISK_SCALE,
  capacityToleranceFlag,
  scoreTolerance,
  type AdvisorProfile,
  type RoomResult,
} from "@lavega/core";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import type { IntakeCopy, IntakeQuestionCopy } from "../copy/intake.js";
import { formatWholeEuroIn } from "../format.js";
import type { Locale } from "../locale.js";
import {
  applyKnowledge,
  applyRiskAnswers,
  applyWorries,
  capacityFor,
  completeBlock,
  resolveRoom,
} from "./state.js";

type Props = {
  copy: IntakeCopy;
  locale: Locale;
  asOf: string;
  profile: AdvisorProfile;
  computedRoom: RoomResult;
  update: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<boolean>;
  onDone: () => void;
};

function Question({
  name,
  q,
  optionIds,
  money,
  value,
  onPick,
}: {
  name: string;
  q: IntakeQuestionCopy;
  optionIds: string[];
  money: (euros: number) => string;
  value: string | undefined;
  onPick: (optionId: string) => void;
}) {
  return (
    <fieldset className="mb-[var(--sp-4)] border-0 p-0" data-testid={`q-${name}`}>
      <legend className="mb-2">{q.prompt(money)}</legend>
      <div className="flex flex-col gap-1">
        {optionIds.map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input
              type="radio"
              name={name}
              value={o}
              checked={value === o}
              onChange={() => onPick(o)}
            />
            {q.options[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Block3(p: Props) {
  const { copy: c, locale, profile } = p;
  const b = c.block3;
  const money = (euros: number) => formatWholeEuroIn(locale, euros);
  const [risk, setRisk] = useState<Record<string, string>>({ ...profile.risk?.answers });
  const [know, setKnow] = useState<Record<string, string>>({
    ...profile.knowledge?.value.answers,
  });
  const [invested, setInvested] = useState<boolean | null>(
    profile.knowledge?.value.investedBefore ?? null,
  );
  const [worries, setWorries] = useState(profile.worries?.value ?? "");

  const tolerance = scoreTolerance(risk).score;
  const { room } = resolveRoom(p.computedRoom, profile);
  const capacity = capacityFor(profile, room, p.asOf).score;
  const flag = capacityToleranceFlag(capacity, tolerance);
  const knowledgeDone =
    KNOWLEDGE_QUESTIONS.every((q) => know[q.id] !== undefined) && invested !== null;

  function pickRisk(item: string, option: string) {
    const next = { ...risk, [item]: option };
    setRisk(next);
    void p.update((pr) => applyRiskAnswers(pr, next, p.asOf));
  }

  function pickKnowledge(item: string, option: string) {
    const next = { ...know, [item]: option };
    setKnow(next);
    void p.update((pr) => applyKnowledge(pr, next, invested, p.asOf));
  }

  function pickInvested(v: boolean) {
    setInvested(v);
    void p.update((pr) => applyKnowledge(pr, know, v, p.asOf));
  }

  function saveWorries() {
    const t = worries.trim();
    if (t !== (profile.worries?.value ?? "")) void p.update((pr) => applyWorries(pr, t, p.asOf));
  }

  async function finish() {
    if (!knowledgeDone) return;
    const t = worries.trim();
    const ok = await p.update((pr) =>
      completeBlock(t === (pr.worries?.value ?? "") ? pr : applyWorries(pr, t, p.asOf), 3),
    );
    if (ok) p.onDone();
  }

  return (
    <>
      <Card as="section" aria-label={b.title}>
        <h2>{b.title}</h2>
        <p className="text-muted text-[0.85rem]">{b.intro}</p>
      </Card>

      <Card as="section" aria-label={b.risk.title}>
        <h3 className="m-0">{b.risk.title}</h3>
        <p className="text-muted text-[0.85rem]">{b.risk.intro}</p>
        {RISK_SCALE.items.map((item) => {
          const q = b.risk.items[item.id];
          return q ? (
            <Question
              key={item.id}
              name={`risk-${item.id}`}
              q={q}
              optionIds={item.options.map((o) => o.id)}
              money={money}
              value={risk[item.id]}
              onPick={(o) => pickRisk(item.id, o)}
            />
          ) : null;
        })}
        <p className="text-muted text-[0.85rem]">{b.risk.scaleNote}</p>
      </Card>

      <Card as="section" aria-label={b.knowledge.title}>
        <h3 className="m-0">{b.knowledge.title}</h3>
        <p className="text-muted text-[0.85rem]">{b.knowledge.intro}</p>
        {KNOWLEDGE_QUESTIONS.map((item) => {
          const q = b.knowledge.items[item.id];
          return q ? (
            <Question
              key={item.id}
              name={`know-${item.id}`}
              q={q}
              optionIds={item.options.map((o) => o.id)}
              money={money}
              value={know[item.id]}
              onPick={(o) => pickKnowledge(item.id, o)}
            />
          ) : null;
        })}
        <fieldset className="border-0 p-0" data-testid="q-invested">
          <legend className="mb-2">{b.knowledge.invested.prompt}</legend>
          <div className="flex flex-col gap-1">
            {([true, false] as const).map((v) => (
              <label key={String(v)} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="invested"
                  checked={invested === v}
                  onChange={() => pickInvested(v)}
                />
                {v ? b.knowledge.invested.yes : b.knowledge.invested.no}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card as="section" aria-label={b.worries.title}>
        <h3 className="m-0">{b.worries.title}</h3>
        <label htmlFor="in-worries">{b.worries.prompt}</label>
        <textarea
          id="in-worries"
          rows={3}
          className="w-full"
          value={worries}
          onChange={(e) => setWorries(e.target.value)}
          onBlur={saveWorries}
        />
        <p className="text-muted text-[0.85rem]">{b.worries.hint}</p>
      </Card>

      <Card as="section" aria-label={b.result.title} data-testid="risk-result">
        <h3 className="m-0">{b.result.title}</h3>
        <p className="m-0 mt-2">
          {tolerance === null ? b.result.toleranceUnknown : b.result.tolerance(tolerance)}
        </p>
        <p className="m-0">
          {capacity === null ? b.result.capacityUnknown : b.result.capacity(capacity)}
        </p>
        {flag === "disagree" && (
          <p role="status" data-testid="risk-flag">
            {b.result.disagree}
          </p>
        )}
        {flag === "agree" && <p className="text-muted text-[0.85rem]">{b.result.agree}</p>}
      </Card>

      <div className="mt-4">
        <Button variant="primary" disabled={!knowledgeDone} onClick={() => void finish()}>
          {b.finish}
        </Button>
        {!knowledgeDone && <p className="text-muted text-[0.85rem]">{b.needMore}</p>}
      </div>
    </>
  );
}
