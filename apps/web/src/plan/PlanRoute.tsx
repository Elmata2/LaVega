import { useAppLocale } from "../appLocale.js";
import Button from "../components/ui/Button.js";
import { intakeCopy } from "../copy/intake.js";
import Plan, { type PlanProps } from "../views/Plan.js";
import { usePlan, type UsePlanInput } from "./usePlan.js";

export type PlanRouteProps = UsePlanInput &
  Pick<PlanProps, "onSaveProfile" | "onNavigate" | "onSaveRewards"> & {
    profileRead: PlanProps["profileRead"] | "loading" | "error";
    onRetry: () => void;
  };

/** The /app/plan route. It exists so the plan is computed only while the page
 *  is open, and so the loading, error and corrupt-profile states are the
 *  intake's own (never an invitation to start over a profile that did not
 *  load). The plan and event sections load inside `usePlan`. */
export default function PlanRoute({
  profileRead,
  onRetry,
  onSaveProfile,
  onNavigate,
  onSaveRewards,
  ...input
}: PlanRouteProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale];
  const loaded = profileRead !== "loading" && profileRead !== "error";
  const plan = usePlan({ ...input, ready: (input.ready ?? true) && loaded });
  if (profileRead === "loading") return <p role="status">{c.loading}</p>;
  if (profileRead === "error") {
    return (
      <div role="alert">
        <p className="text-warn">{c.loadError}</p>
        <Button onClick={onRetry}>{c.retry}</Button>
      </div>
    );
  }
  return (
    <Plan
      plan={plan}
      store={input.store}
      profileRead={profileRead}
      asOf={input.asOf}
      onSaveProfile={onSaveProfile}
      onNavigate={onNavigate}
      rewards={input.rewards}
      {...(onSaveRewards === undefined ? {} : { onSaveRewards })}
      accounts={input.accounts}
      entityProfiles={input.entityProfiles}
    />
  );
}
