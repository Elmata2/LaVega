import { useEffect, useState } from "react";
import type { Alert } from "@lavega/core";
import Module from "../Module.js";

/* Aandacht — the alert centre plus the buffer that defines "too low".
 *
 * A self-contained block: it receives the already-computed alerts and owns
 * nothing but the draft text of the buffer input. */

type AandachtBlockProps = {
  alerts: Alert[];
  /** Warn below this balance, in integer cents. */
  bufferCents: number;
  onBufferChange: (cents: number) => void;
};

const SEV_ICON: Record<Alert["severity"], string> = { critical: "🔴", warning: "🟠", info: "🟡" };

export default function AandachtBlock({ alerts, bufferCents, onBufferChange }: AandachtBlockProps) {
  // Draft while typing, commit on blur. Resyncs when the stored buffer changes
  // elsewhere (e.g. a restored back-up).
  const [draft, setDraft] = useState(bufferCents ? String(bufferCents / 100) : "");
  useEffect(() => setDraft(bufferCents ? String(bufferCents / 100) : ""), [bufferCents]);

  function commit() {
    const t = draft.trim().replace(/[€\s]/g, "").replace(",", ".");
    const n = t === "" ? 0 : Number(t);
    if (Number.isFinite(n) && n >= 0) onBufferChange(Math.round(n * 100));
  }

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
          Waarschuw onder buffer €{" "}
          <input
            className="saldo-input"
            inputMode="decimal"
            placeholder="0"
            aria-label="Waarschuwingsbuffer in euro"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
        </label>
      }
    >
      {alerts.length === 0 ? (
        <p className="block-empty text-pos">
          Geen aandachtspunten — je verwachte saldo blijft boven je buffer en er zijn geen gemiste betalingen.
        </p>
      ) : (
        <div className="alert-rows">
          {alerts.map((a) => (
            <div className="alert-row" key={a.id}>
              <div className="alert-row-title">
                <span aria-hidden="true">{SEV_ICON[a.severity]}</span>
                {a.title}
              </div>
              <div className="cell-sub">{a.detail}</div>
            </div>
          ))}
        </div>
      )}
    </Module>
  );
}
