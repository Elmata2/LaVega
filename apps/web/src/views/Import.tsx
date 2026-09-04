import BankLink from "../components/BankLink";

type ImportProps = {
  entity: string;
  onEntityChange: (entity: string) => void;
  busy: boolean;
  problems: string[];
  onImport: (file: File) => void;
};

export default function Import({ entity, onEntityChange, busy, problems, onImport }: ImportProps) {
  return (
    <section id="import" className="card" aria-label="Importeren">
      <h2>Importeren</h2>
      {/* One wrapping row: a native file input reports its own intrinsic width,
          which overflowed the page at phone width when it sat inline. */}
      <div className="import-controls">
        <label>
          Entiteit{" "}
          <input value={entity} onChange={(e) => onEntityChange(e.target.value)} disabled={busy} />
        </label>
        {/* No `accept` filter: format is detected from the file's *contents*
            (parseBankFile sniffs MT940 vs CSV), so restricting extensions only
            risks the OS dialog greying out a valid file (e.g. an uppercase
            .STA). An unrecognized file is reported via `problems`, not a crash. */}
        <input
          type="file"
          className="btn import-file"
          aria-label="Kies een bankbestand om te importeren"
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
    </section>
  );
}
