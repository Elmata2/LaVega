/* Every status variant side by side, for the black-and-white check. Preview
 * only: reached through harness mode "status", never imported by the product. */
import type { Alert } from "@lavega/core";
import AandachtBlock from "../components/blocks/AandachtBlock";
import Badge from "../components/ui/Badge";
import StatusLine, { type StatusTone } from "../components/ui/StatusLine";
import StatusChip from "../plan/StatusChip";
import { planShellCopy } from "../copy/plan/index.js";

const TONES: StatusTone[] = ["warning", "problem", "success"];
const ALERTS: Alert[] = [
  { id: "a1", severity: "critical", body: { kind: "no-balance", count: 1 } },
  { id: "a2", severity: "warning", body: { kind: "no-balance", count: 2 } },
  { id: "a3", severity: "info", body: { kind: "no-balance", count: 3 } },
];

export default function StatusSheet() {
  const shell = planShellCopy.nl;
  return (
    <div className="pv-pad" data-testid="status-sheet" style={{ display: "grid", gap: 16 }}>
      <h2>Status lines</h2>
      {TONES.map((t) => (
        <StatusLine key={t} tone={t} role="status">
          {t}: a short sentence that states what happened
        </StatusLine>
      ))}
      <h2>Badges</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <Badge>none</Badge>
        {TONES.map((t) => (
          <Badge key={t} tone={t}>
            {t}
          </Badge>
        ))}
      </div>
      <h2>Dots</h2>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span className="dot dot-pos" /> pos
        <span className="dot dot-warn" /> warn
        <span className="dot dot-neg" /> neg
      </div>
      <h2>Plan chips</h2>
      <div style={{ display: "flex", gap: 8 }}>
        {(["on-track", "attention", "not-enough-data"] as const).map((s) => (
          <StatusChip key={s} status={s} shell={shell} />
        ))}
      </div>
      <h2>Aandacht tiers</h2>
      <AandachtBlock alerts={ALERTS} bufferCents={250_000} onBufferChange={() => {}} />
    </div>
  );
}
