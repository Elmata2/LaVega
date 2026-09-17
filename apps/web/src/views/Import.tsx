import BankLink from "../components/BankLink";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { buttonVariants } from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { cn } from "../components/ui/utils.js";

type ImportProps = {
  entity: string;
  onEntityChange: (entity: string) => void;
  busy: boolean;
  problems: string[];
  onImport: (file: File) => void;
};

export default function Import({ entity, onEntityChange, busy, problems, onImport }: ImportProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  return (
    <Card as="section" id="import" aria-label={c.import.ariaLabel}>
      <h2>{c.import.heading}</h2>
      {/* One wrapping row: a native file input reports its own intrinsic width,
          which overflowed the page at phone width when it sat inline. */}
      <div className="import-controls">
        <label>
          {c.import.entityLabel}{" "}
          <input value={entity} onChange={(e) => onEntityChange(e.target.value)} disabled={busy} />
        </label>
        {/* No `accept` filter: format is detected from the file's *contents*
            (parseBankFile sniffs MT940 vs CSV), so restricting extensions only
            risks the OS dialog greying out a valid file (e.g. an uppercase
            .STA). An unrecognized file is reported via `problems`, not a crash. */}
        <input
          type="file"
          className={cn(buttonVariants(), "import-file")}
          aria-label={c.import.fileInputAriaLabel}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImport(file);
          }}
        />
      </div>
      {problems.length > 0 && (
        <p role="alert" className="text-warn">
          {problems.join(", ")}
        </p>
      )}
      <BankLink busy={busy} />
    </Card>
  );
}
