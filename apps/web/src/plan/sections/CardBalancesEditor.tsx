import { useState } from "react";
import { useAppLocale } from "../../appLocale.js";
import { cardAdviceCopy } from "../../copy/cardAdvice.js";
import { wizardCopy } from "../../copy/wizard.js";
import { applyCardBalances } from "../../intake/state.js";
import { applyPoints, cardName, detailRows } from "../../intake/wizard/cardDetails.js";
import CardDetailsForm from "../../intake/wizard/CardDetailsForm.js";
import { upsertBalance } from "../../views/Punten.js";
import { saveProfile } from "./profileEdits.js";
import type { PlanCtx } from "./types.js";

/** The balance, paid-in-full, rate and points of the stated credit cards, edited
 *  with the same form the intake uses. Saved to the profile (balances) and the
 *  Punten store (points). */
export default function CardBalancesEditor({ ctx }: { ctx: PlanCtx }) {
  const [locale] = useAppLocale();
  const w = wizardCopy[locale];
  const c = cardAdviceCopy[locale];
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const profile = ctx.profile.store?.current;
  const cardIds = profile?.statedCards?.value ?? [];
  const rewards = ctx.rewards ?? [];
  if (cardIds.length === 0) return <p className="m-0 mb-3 text-muted">{c.noCardsToEdit}</p>;

  const rows = detailRows({
    cardIds,
    balances: profile?.cardBalances?.value ?? [],
    rewards,
    nameOf: (id) => cardName(id, w.otherCard, w.cardDetails.unknownCard),
    askPoints: ctx.saveRewards !== undefined,
  });
  const key = JSON.stringify([
    profile?.cardBalances?.value ?? [],
    rows.map((r) => r.points),
  ]);
  return (
    <div className="mb-3" data-testid="plan-card-details">
      <h5 className="m-0 mb-1 text-[0.85rem] font-semibold">{c.editTitle}</h5>
      <p className="m-0 mb-2 text-muted text-[0.85rem]">{c.editNote}</p>
      <CardDetailsForm
        key={key}
        copy={w}
        rows={rows}
        busy={busy}
        inline
        submitLabel={c.editSave}
        onSubmit={(result) => {
          setBusy(true);
          setStatus("idle");
          void (async () => {
            try {
              if (ctx.saveRewards !== undefined) {
                const next = applyPoints(rewards, result.points, ctx.asOf, upsertBalance);
                if (next !== null) await ctx.saveRewards(next);
              }
              await saveProfile(ctx, (p) => applyCardBalances(p, result.balances, ctx.asOf));
              setStatus("saved");
            } catch {
              setStatus("failed");
            } finally {
              setBusy(false);
            }
          })();
        }}
        footer={
          status === "idle" ? null : (
            <p
              role={status === "failed" ? "alert" : "status"}
              data-testid="plan-card-details-status"
              className={status === "failed" ? "wz-error" : "wz-hint"}
            >
              {status === "failed" ? c.editFailed : c.editSaved}
            </p>
          )
        }
      />
    </div>
  );
}
