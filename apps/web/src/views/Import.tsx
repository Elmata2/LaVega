import { SHOW_ENTITY_CLASSIFIER } from "../archive.js";
import BankLink from "../components/BankLink";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { buttonVariants } from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { cn } from "@lavega/ui";
import StatusLine from "../components/ui/StatusLine.js";
import type { ShellNotice } from "../shellNotice.js";
import { useOpenCardFile } from "../components/import/CardFileContext.js";
import { cardFileCopy } from "../copy/cardFile.js";

type ImportProps = {
  entity: string;
  onEntityChange: (entity: string) => void;
  busy: boolean;
  problems: ShellNotice[];
  onRefreshBank: () => void;
  /** Passed on to BankLink: runs just before the redirect to the bank. */
  onBeforeBankRedirect?: () => void | Promise<void>;
  bankDefaultPsuType?: "business" | "personal";
};

export default function Import({
  entity,
  onEntityChange,
  busy,
  problems,
  onRefreshBank,
  onBeforeBankRedirect,
  bankDefaultPsuType,
}: ImportProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const openCardFile = useOpenCardFile();
  const fc = cardFileCopy[locale];
  return (
    <Card as="section" id="import" aria-label={c.import.ariaLabel}>
      <h2>{c.import.heading}</h2>
      {/* One wrapping row: a native file input reports its own intrinsic width,
          which overflowed the page at phone width when it sat inline. */}
      <div className="import-controls">
        {SHOW_ENTITY_CLASSIFIER && (
          <label>
            {c.import.entityLabel}{" "}
            <input
              value={entity}
              onChange={(e) => onEntityChange(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {openCardFile && (
          <button
            type="button"
            className={cn(buttonVariants(), "import-file min-h-[44px]")}
            aria-label={c.import.fileInputAriaLabel}
            disabled={busy}
            onClick={() => openCardFile(null)}
          >
            {fc.upload}
          </button>
        )}
      </div>
      {problems.length > 0 && (
        <StatusLine tone="problem" role="alert">
          {problems.map((n) => c.notice(n)).join(" ")}
        </StatusLine>
      )}
      <BankLink
        busy={busy}
        onRefresh={onRefreshBank}
        {...(onBeforeBankRedirect ? { onBeforeRedirect: onBeforeBankRedirect } : {})}
        {...(bankDefaultPsuType ? { defaultPsuType: bankDefaultPsuType } : {})}
      />
    </Card>
  );
}
