import { useState } from "react";
import type { Alert, AlertSeverity } from "@lavega/core";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import CardLink from "../ui/CardLink.js";
import SaldoInput from "../ui/SaldoInput.js";
import { useAppLocale } from "../../appLocale.js";
import { moneyCopy } from "../../copy/money.js";

/* Aandacht — the alert centre plus the buffer that defines "too low".
 *
 * A self-contained block: it receives the already-computed alerts and owns
 * nothing but the draft text of the buffer input and which tiers are open.
 *
 * The 2026-08-17 round-2 pass ("that's alright, we still need to work on this")
 * changed three things, all of them about the block being believed:
 *
 *   1. THE EMPTY STATE NO LONGER CLAIMS ALL-CLEAR. It used to say "je verwachte
 *      saldo blijft boven je buffer en er zijn geen gemiste betalingen" — a
 *      positive assertion about the data. `computeAlerts` returns an empty list
 *      just as readily when there IS no data: no accounts, no forecast, no
 *      streams, nothing to miss. So an empty vault read as a clean bill of
 *      health. It now says what was checked, and that the check is only worth
 *      what was imported.
 *   2. SEVERITY IS A WORD, NOT ONLY A COLOURED CIRCLE. The 🔴/🟠/🟡 were
 *      aria-hidden, so the ranking core computes was invisible to a screen
 *      reader and to anyone who does not decode three near-identical dots. The
 *      alerts are now grouped under their tier, and each tier is named.
 *   3. THE INFO TIER FOLDS AWAY when there is something real above it. Six
 *      "saldo bijwerken" reminders standing at the same weight as a forecast
 *      shortfall is exactly how a block earns the right to be ignored.
 *
 * What it still cannot do: show the money at stake as a figure, sort within a
 * tier by urgency, or turn "vul in bij Rekeningen" into a link. `Alert` is
 * `{ id, severity, body }`, with `body` a discriminated `AlertBody` carrying
 * the facts (dates, cents, counterparty) core computed — the title/detail
 * SENTENCE is rendered here via `copy/money.ts`'s `aandacht.alert`, per
 * locale. Ranking within a tier or acting on the money is possible now that
 * the facts are structured; it just isn't built yet. */

type AandachtBlockProps = {
  alerts: Alert[];
  /** Warn below this balance, in integer cents. */
  bufferCents: number;
  onBufferChange: (cents: number) => void;
};

type Tier = { severity: AlertSeverity; icon: string };

/** Ranked hardest-first, the same order core sorts in. The word is the label;
 *  the circle only reinforces it, so it stays aria-hidden. */
const TIERS: Tier[] = [
  { severity: "critical", icon: "🔴" },
  { severity: "warning", icon: "🟠" },
  { severity: "info", icon: "🟡" },
];

/** Below this, folding costs more than it saves: the "Toon 2 ter info" button
 *  takes the same line the two rows would have. */
const INFO_FOLD_MIN = 3;

/* The tier's own colour on the WORD only (see blocks.css history): "info" gets
 * no override and inherits the head's muted colour. */
const TIER_TEXT_COLOR: Record<AlertSeverity, string> = {
  critical: "text-neg",
  warning: "text-warn",
  info: "",
};

export default function AandachtBlock({ alerts, bufferCents, onBufferChange }: AandachtBlockProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].aandacht;
  const tierLabel: Record<AlertSeverity, string> = {
    critical: c.kritiek,
    warning: c.letOp,
    info: c.terInfo,
  };
  const [draft, setDraft] = useState(bufferCents ? String(bufferCents / 100) : "");
  const [prevBuffer, setPrevBuffer] = useState(bufferCents);
  if (bufferCents !== prevBuffer) {
    setPrevBuffer(bufferCents);
    setDraft(bufferCents ? String(bufferCents / 100) : "");
  }

  const [showInfo, setShowInfo] = useState(false);

  function commit() {
    const t = draft
      .trim()
      .replace(/[€\s]/g, "")
      .replace(",", ".");
    const n = t === "" ? 0 : Number(t);
    if (Number.isFinite(n) && n >= 0) onBufferChange(Math.round(n * 100));
  }

  const byTier = TIERS.map((tier) => ({
    tier,
    rows: alerts.filter((a) => a.severity === tier.severity),
  }));
  const pressing = byTier
    .filter((g) => g.tier.severity !== "info")
    .reduce((n, g) => n + g.rows.length, 0);
  const infoCount = byTier.find((g) => g.tier.severity === "info")?.rows.length ?? 0;
  // Only fold the info tier, and only when something above it is competing for
  // the same glance. On its own it is the whole block, so it stays open.
  const foldInfo = pressing > 0 && infoCount >= INFO_FOLD_MIN && !showInfo;

  /* A buffer of zero is not "no preference": it silently turns the shortfall
   * alert into an overdraft alert, because the forecast only flags a week whose
   * closing balance falls BELOW the buffer. Left unsaid, an owner who never set
   * one reads "geen aandachtspunten" as "I have room". */
  const zeroBuffer = bufferCents === 0;

  return (
    <Module
      title="Aandacht"
      span={3}
      // hug: full width with only a line or two in it, so don't reserve the
      // grid's short-module height. head-wrap: the buffer editor is a labelled
      // input, wider than the pill the control slot is sized for.
      className="module-hug module-head-wrap"
      menu={
        <label className="buffer-field eyebrow">
          {c.waarschuwOnderBuffer}
          {" "}
          <SaldoInput
            inputMode="decimal"
            placeholder="0"
            aria-label={c.waarschuwingsbufferAria}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
        </label>
      }
      footer={
        zeroBuffer ? <span className="cell-sub">{c.bufferZeroNote}</span> : undefined
      }
    >
      {alerts.length === 0 ? (
        /* Not "alles is in orde" — that is a claim about the data, and an empty
         * vault produces exactly this same empty list. State the scope instead. */
        <div className="flex flex-col gap-2">
          <p className="block-empty text-pos m-0 leading-[1.5]">{c.nietsGevondenOmJeOpTeWijzen}</p>
          <p className="cell-sub m-0 leading-[1.5]">{c.lavegaKeekNaar(c.checks.join(", "))}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {byTier.map(({ tier, rows }) => {
            if (rows.length === 0) return null;
            const folded = tier.severity === "info" && foldInfo;
            return (
              <section
                className="flex flex-col gap-2"
                data-testid="alert-tier"
                key={tier.severity}
                aria-label={`${tierLabel[tier.severity]} (${rows.length})`}
              >
                <h3
                  className={`flex items-center gap-2 m-0 font-mono text-[0.72rem] font-semibold tracking-[0.06em] uppercase text-muted ${TIER_TEXT_COLOR[tier.severity]}`}
                >
                  <span aria-hidden="true">{tier.icon}</span>
                  {tierLabel[tier.severity]}
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] py-0 px-[5px] rounded-pill border border-line bg-surface-2 text-muted text-[0.7rem] tabular-nums">
                    {rows.length}
                  </span>
                </h3>
                {folded ? (
                  <CardLink onClick={() => setShowInfo(true)}>{c.toonNTerInfo(rows.length)}</CardLink>
                ) : (
                  <div className="flex flex-col">
                    {rows.map((a) => (
                      <div
                        className="py-3 px-0 border-b border-line first:pt-0 last:border-b-0 last:pb-0"
                        data-testid="alert-row"
                        key={a.id}
                      >
                        <div className="flex items-center gap-2 font-semibold">
                          {c.alert.title(a.body)}
                        </div>
                        <div className="cell-sub">{c.alert.detail(a.body)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Module>
  );
}

/** Aandacht as the homescreen should place it: itself when switched on in
 *  Profiel, nothing when off. See PositieWidget — same gate, same reason.
 *
 *  Worth being explicit about one consequence: with this widget off, the alert
 *  centre is not on the homescreen at all. Nothing else claims that everything
 *  is fine in its place, which is the only outcome that would be dishonest —
 *  an absent block says nothing, and saying nothing is correct here. */
export function AandachtWidget(props: AandachtBlockProps) {
  return useWidgetEnabled("aandacht") ? <AandachtBlock {...props} /> : null;
}
