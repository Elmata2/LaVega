import type { Account, AdvisorProfileStore, RoomResult } from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { intakeCopy } from "../../copy/intake.js";
import { blockingInfoOf, RoomBody } from "../../intake/RoomPayoff.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import CardLink from "../ui/CardLink.js";

type Range = { lowCents: number; highCents: number };

export type RoomCardProps = {
  result: RoomResult;
  onOpenIntake: () => void;
  /** Names the accounts that stop months from counting. */
  accounts?: Account[];
  statedInputs?: { income: Range; spend: Range };
  /** Where data comes in; shown when there is not enough of it. */
  onImport?: () => void;
};

/** "Your room each month" on the home screen. The figures and the calculation
 *  are the same ones the intake closes with; this adds the way back. */
export default function RoomCard({
  result,
  onOpenIntake,
  accounts = [],
  statedInputs,
  onImport,
}: RoomCardProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale];
  const needsData =
    result.kind === "none" ||
    (result.kind === "computed" &&
      (result.partial || result.excludedForeignCount > 0 || result.blockingAccounts.length > 0));
  return (
    <Module
      title={c.home.room.title}
      span={3}
      footer={
        <>
          <CardLink onClick={onOpenIntake}>{c.home.room.open}</CardLink>
          {needsData && onImport && (
            <>
              {" "}
              <CardLink onClick={onImport}>{c.home.room.importLink}</CardLink>
            </>
          )}
        </>
      }
    >
      <div data-testid="room-card">
        <RoomBody
          copy={c}
          locale={locale}
          room={result}
          {...(statedInputs ? { statedInputs } : {})}
          blocking={blockingInfoOf(result, accounts, c.payoff.anAccount)}
        />
      </div>
    </Module>
  );
}

/** Block 1 done (or later) is what makes a room worth showing. */
export const showsRoom = (store: AdvisorProfileStore | null): boolean =>
  store !== null && store.current.intake.blocksDone >= 1;

export function RoomCardWidget(props: RoomCardProps & { store: AdvisorProfileStore | null }) {
  const on = useWidgetEnabled("room-card");
  const { store, ...card } = props;
  return on && showsRoom(store) ? <RoomCard {...card} /> : null;
}
