import Optimalisatie from "../views/Optimalisatie.js";
import { usePlan, type UsePlanInput } from "./usePlan.js";

type OptimalisatieProps = Parameters<typeof Optimalisatie>[0];

/** The /app/optimalisatie route. The credit-card block must show the very answer
 *  "Jouw plan" shows, so it runs the same plan computation (`usePlan`) with the
 *  same inputs (`planInput` is the one object App hands to both routes) and
 *  passes `plan.sections.cards.figures.advice` down. Only one of the two routes
 *  is mounted at a time, so the plan is computed once per screen. It is read-only: a visit here must
 *  never store a plan snapshot (only "Jouw plan" may). */
export default function OptimalisatieRoute({
  planInput,
  profileLoaded,
  ...props
}: Omit<OptimalisatieProps, "cardAdvice"> & {
  planInput: UsePlanInput;
  /** The adviser profile has been read; the plan is not trusted before. */
  profileLoaded: boolean;
}) {
  const plan = usePlan({
    ...planInput,
    readOnly: true,
    ready: (planInput.ready ?? true) && profileLoaded,
  });
  // The plan reads the stored preferences first; until they are read the figure
  // could still change, so the block shows nothing rather than a wrong line.
  const cardAdvice =
    profileLoaded && plan.loaded ? plan.result.sections.cards.figures.advice : null;
  return <Optimalisatie {...props} cardAdvice={cardAdvice} />;
}
