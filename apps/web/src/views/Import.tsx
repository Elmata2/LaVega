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
      <label>
        Entiteit{" "}
        <input
          value={entity}
          onChange={(e) => onEntityChange(e.target.value)}
          disabled={busy}
        />
      </label>
      {" "}
      {/* No `accept` filter: format is detected from the file's *contents*
          (parseBankFile sniffs MT940 vs CSV), so restricting extensions only
          risks the OS dialog greying out a valid file (e.g. an uppercase
          .STA). An unrecognized file is reported via `problems`, not a crash. */}
      <input
        type="file"
        className="btn"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onImport(file);
        }}
      />
      {problems.length > 0 && (
        <p role="alert" className="text-warn">
          {problems.join(", ")}
        </p>
      )}
    </section>
  );
}
