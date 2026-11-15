import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import type { Account, RoomResult } from "@lavega/core";

type Range = { lowCents: number; highCents: number };
import type { IntakeCopy } from "../copy/intake.js";
import { formatWholeEuroIn, monthLabel } from "../format.js";
import type { Locale } from "../locale.js";

export type BlockingInfo = { name: string; reason: "stale" | "short"; since?: string };

/** The accounts that stop months from counting, with a name to show: the
 *  account's name, else its bank, else a generic "an account". Never the key. */
export function blockingInfoOf(
  room: RoomResult,
  accounts: readonly Account[],
  fallbackName: string,
): BlockingInfo[] {
  if (room.kind === "stated" || (room.kind === "none" && room.reason === "no-data")) return [];
  return room.blockingAccounts.map((b) => {
    const a = accounts.find((x) => x.key === b.id);
    return {
      name: a?.name?.trim() || a?.bank?.trim() || fallbackName,
      reason: b.reason,
      ...(b.since ? { since: b.since } : {}),
    };
  });
}

/** A whole-euro amount, rounded first so a few cents never read "-€0"; a
 *  negative one reads "-€120", not "€-120". */
const signedEuro = (locale: Locale, cents: number): string => {
  const euros = Math.round(cents / 100) + 0; // + 0 turns -0 into 0
  return euros < 0 ? `-${formatWholeEuroIn(locale, -euros)}` : formatWholeEuroIn(locale, euros);
};

/** The figures of "Your room each month": headline, range, notes and the
 *  calculation one click away. Shared by the intake payoff and the home card.
 *  Every figure is computed in core; this only formats it. */
export function RoomBody({
  copy: c,
  locale,
  room,
  statedInputs,
  blocking: blockingAccounts = [],
}: {
  copy: IntakeCopy;
  locale: Locale;
  room: RoomResult;
  /** The ranges a stated room was worked out from, shown in its calculation. */
  statedInputs?: { income: Range; spend: Range };
  /** The accounts that stop months from counting. */
  blocking?: BlockingInfo[];
}) {
  const p = c.payoff;
  const eur = (cents: number) => signedEuro(locale, cents);
  // A stale account can leave the room on OLDER months with partial false; the
  // notice shows whenever any account blocks the latest three.
  const blocked =
    room.kind === "none" ||
    (room.kind === "computed" && (room.partial || room.blockingAccounts.length > 0));
  const blocking =
    blocked && blockingAccounts.length > 0 ? (
      <div data-testid="room-blocking">
        {blockingAccounts.map((b, i) => (
          <p key={i} className="text-muted text-[0.85rem]" data-reason={b.reason}>
            {b.reason === "stale"
              ? p.blocking.stale(b.name)
              : p.blocking.short(b.name, monthLabel(locale, b.since ?? ""))}
          </p>
        ))}
      </div>
    ) : null;
  if (room.kind === "none") {
    return (
      <>
        <p data-testid="room-none">
          {room.reason === "no-data" ? p.none.noData : p.none.noFullMonth}
        </p>
        {blocking}
      </>
    );
  }
  return (
    <>
      {room.kind === "computed" ? (
        <p className="m-0 text-[1.6rem] font-medium" data-testid="room-headline">
          {p.headline(eur(room.middleCents))}
        </p>
      ) : null}
      <p className="m-0 mt-1" data-testid="room-range">
        {p.range(eur(room.lowCents), eur(room.highCents))}
      </p>
      {room.kind === "computed" && room.partial && (
        <p className="text-muted text-[0.85rem]">{p.partial(room.months.length)}</p>
      )}
      {blocking}
      {room.kind === "stated" && <p className="text-muted text-[0.85rem]">{p.stated}</p>}
      <details className="mt-3">
        <summary className="cursor-pointer text-muted">{p.showCalc}</summary>
        <div className="mt-2">
          {room.kind === "computed" ? (
            <>
              <ul className="list-none p-0">
                {room.months.map((m) => (
                  <li key={m.month} className="text-muted text-[0.85rem]">
                    {p.monthLine(
                      monthLabel(locale, m.month),
                      eur(m.incomingCents),
                      eur(m.outgoingCents),
                      eur(m.netCents),
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-muted text-[0.85rem]">{p.middleNote}</p>
              <p className="text-muted text-[0.85rem]">{p.rulesNote}</p>
              {room.excludedForeignCount > 0 && (
                <p className="text-muted text-[0.85rem]">
                  {p.foreignExcluded(room.excludedForeignCount)}
                </p>
              )}
            </>
          ) : (
            statedInputs && (
              <p className="text-muted text-[0.85rem]">
                {p.statedCalc(
                  eur(statedInputs.income.lowCents),
                  eur(statedInputs.income.highCents),
                  eur(statedInputs.spend.lowCents),
                  eur(statedInputs.spend.highCents),
                )}
              </p>
            )
          )}
        </div>
      </details>
    </>
  );
}

/** "Your room each month" as the closing card of the intake. */
export default function RoomPayoff({
  copy: c,
  locale,
  room,
  statedInputs,
  blocking,
  hideContinue = false,
  onContinue,
}: {
  copy: IntakeCopy;
  locale: Locale;
  room: RoomResult;
  statedInputs?: { income: Range; spend: Range };
  blocking?: BlockingInfo[];
  hideContinue?: boolean;
  onContinue: () => void;
}) {
  const p = c.payoff;
  return (
    <Card as="section" aria-label={p.title} data-testid="room-payoff">
      <h2>{p.title}</h2>
      <RoomBody
        copy={c}
        locale={locale}
        room={room}
        statedInputs={statedInputs}
        blocking={blocking}
      />
      {!hideContinue && (
        <div className="mt-4">
          <Button variant="primary" onClick={onContinue}>
            {p.continue}
          </Button>
        </div>
      )}
    </Card>
  );
}
