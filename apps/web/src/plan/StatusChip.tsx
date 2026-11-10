import type { PlanStatus } from "@lavega/core";
import Badge from "../components/ui/Badge.js";
import type { PlanShellCopy } from "../copy/plan/index.js";

/** Word plus symbol, never colour alone. The symbol is decoration; the word
 *  is the text a screen reader gets. */
export default function StatusChip({
  status,
  shell,
  testId,
}: {
  status: PlanStatus;
  shell: PlanShellCopy;
  testId?: string;
}) {
  const s = shell.status[status];
  return (
    <Badge
      data-testid={testId ?? "plan-status-chip"}
      data-status={status}
      className={status === "attention" ? "border-warn text-warn" : undefined}
    >
      <span aria-hidden="true" className="mr-1">
        {s.symbol}
      </span>
      {s.word}
    </Badge>
  );
}
