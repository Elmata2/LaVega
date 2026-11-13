import { Context, DateTime, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
  BROKER_SYNC_LEASE_TTL_MS,
  createBrokerDataCache,
  createDeGiroFileImport,
  type BrokerAccountSnapshot,
  type BrokerSyncOperationStore,
  type BrokerSyncProgressRecord,
} from "@lavega/adapters";
import {
  parseBrokerFile,
  redactProblem,
  type BrokerFileInput,
  type CashHistoryCoverage,
  type ParsedBrokerFile,
} from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

/** The upload limit. Vercel stops a request body at 4.5 MB, so the route
 *  refuses a little earlier with a message the user can act on. */
export const DEGIRO_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const DEGIRO_IMPORT_MAX_FILES = 3;

export type DeGiroImportMode = "preview" | "commit";

/** The rows one file parsed into, as the preview reports them. A file with an
 *  unknown header contributes no profile and no rows, only its problems. */
type ImportRows = {
  trades: ParsedBrokerFile["trades"];
  cashFlows: NonNullable<ParsedBrokerFile["cashFlows"]>;
  dividends: NonNullable<ParsedBrokerFile["dividends"]>;
  positions: ParsedBrokerFile["positions"];
  cashBalances: NonNullable<ParsedBrokerFile["cashBalances"]>;
};

type ImportRowCounts = { [Key in keyof ImportRows]: number };

export type DeGiroImportFileReport = {
  filename: string;
  sha256: string;
  profile?: ParsedBrokerFile["profile"];
  period?: { from: string; to: string };
  rows: ImportRows;
  problems: string[];
};

export type DeGiroImportPreview = {
  mode: "preview";
  files: DeGiroImportFileReport[];
};

export type DeGiroImportCommit = {
  mode: "commit";
  committed: boolean;
  importedAt?: string;
  files: DeGiroImportFileReport[];
  coverage?: CashHistoryCoverage;
  totals: ImportRowCounts;
  problems: string[];
};

export type DeGiroImportResult = DeGiroImportPreview | DeGiroImportCommit;

export class DeGiroImportRequestError extends Schema.TaggedError<DeGiroImportRequestError>()(
  "DeGiroImportRequestError",
  { problems: Schema.Array(Schema.String) },
) {}

export class DeGiroImportTooLargeError extends Schema.TaggedError<DeGiroImportTooLargeError>()(
  "DeGiroImportTooLargeError",
  { problems: Schema.Array(Schema.String) },
) {}

/** The lease is held, or the vault that owns the snapshot cannot be written. */
export class DeGiroImportConflictError extends Schema.TaggedError<DeGiroImportConflictError>()(
  "DeGiroImportConflictError",
  { problems: Schema.Array(Schema.String) },
) {}

export class DeGiroImportFailedError extends Schema.TaggedError<DeGiroImportFailedError>()(
  "DeGiroImportFailedError",
  { problems: Schema.Array(Schema.String) },
) {}

export type DeGiroImportError =
  | DeGiroImportRequestError
  | DeGiroImportTooLargeError
  | DeGiroImportConflictError
  | DeGiroImportFailedError;

const ISO_DAY = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const MODE = Schema.Literals(["preview", "commit"]);

const requestError = (problem: string) => new DeGiroImportRequestError({ problems: [problem] });
const conflictError = (problem: string) => new DeGiroImportConflictError({ problems: [problem] });
const failedError = (problem: string) => new DeGiroImportFailedError({ problems: [problem] });

/** The reader rejects a day it has to invent, so the route does too. */
function isCalendarDay(value: string): boolean {
  const parsed = DateTime.make(`${value}T00:00:00Z`);
  return Option.isSome(parsed) && DateTime.formatIso(parsed.value).slice(0, 10) === value;
}

function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

type Upload = { filename: string; sha256: string; text: string };

function fileReport(upload: Upload, parsed: ParsedBrokerFile): DeGiroImportFileReport {
  return {
    filename: upload.filename,
    sha256: upload.sha256,
    ...(parsed.profile ? { profile: parsed.profile } : {}),
    ...(parsed.period ? { period: parsed.period } : {}),
    rows: {
      trades: parsed.trades,
      cashFlows: parsed.cashFlows ?? [],
      dividends: parsed.dividends ?? [],
      positions: parsed.positions,
      cashBalances: parsed.cashBalances ?? [],
    },
    problems: parsed.problems,
  };
}

function emptyCounts(): ImportRowCounts {
  return { trades: 0, cashFlows: 0, dividends: 0, positions: 0, cashBalances: 0 };
}

function countRows(snapshot: BrokerAccountSnapshot): ImportRowCounts {
  return {
    trades: snapshot.trades.length,
    cashFlows: snapshot.cashFlows?.length ?? 0,
    dividends: snapshot.dividends.length,
    positions: snapshot.positions.length,
    cashBalances: snapshot.cashBalances?.length ?? 0,
  };
}

/** What one tenant's import writes to and reads from. Everything is injected:
 *  the handler runs against one tenant's vault and one broker's lease. */
export type DeGiroImportVault = {
  getBrokerData(): Promise<RuntimeBrokerDataSnapshot | null>;
  putBrokerSnapshot(broker: "degiro", snapshot: BrokerAccountSnapshot): Promise<void>;
  /** Creates the file vault when it is empty; throws when it is locked. */
  ensureWritable(): Promise<void>;
};

export type DeGiroImportSources = {
  vault: DeGiroImportVault;
  operations: BrokerSyncOperationStore;
  entity: string;
  now: () => string;
  /** Mirrors a committed snapshot into the in-process cache and invalidates
   *  the dashboard cache. The import has already been stored when this runs. */
  onCommitted?: (snapshot: BrokerAccountSnapshot) => void | Promise<void>;
};

export class DeGiroImportSource extends Context.Service<DeGiroImportSource, DeGiroImportSources>()(
  "lavega/investing/DeGiroImport/Source",
) {}

/**
 * DeGiro file import: a preview parses and writes nothing, and a commit merges
 * one import into the stored snapshot under the broker lease.
 *
 * The raw file never leaves this module. The snapshot keeps the parsed rows and
 * a SHA-256 per file; that is the provenance a later read uses to show the
 * import's age and the files it came from.
 */
export class DeGiroImport extends Context.Service<
  DeGiroImport,
  {
    readonly import: (request: Request) => Effect.Effect<DeGiroImportResult, DeGiroImportError>;
  }
>()("lavega/investing/DeGiroImport") {
  static readonly layer: Layer.Layer<DeGiroImport, never, DeGiroImportSource> = Layer.effect(
    DeGiroImport,
    Effect.gen(function* () {
      const sources = yield* DeGiroImportSource;

      const readForm = (request: Request) =>
        Effect.tryPromise({
          try: () => request.formData(),
          catch: () => requestError("The request body must be a multipart form"),
        });

      /* Size and count are checked before any file bytes are read: a 5 MB
       * upload must cost nothing but the body itself. */
      const readUploads = (form: FormData) =>
        Effect.gen(function* () {
          const entries = form.getAll("files");
          if (entries.length === 0) return yield* requestError("At least one file is required");
          if (entries.length > DEGIRO_IMPORT_MAX_FILES)
            return yield* requestError(
              `At most ${DEGIRO_IMPORT_MAX_FILES} files can be imported at once`,
            );
          const files = entries.filter((entry): entry is File => entry instanceof File);
          if (files.length !== entries.length)
            return yield* requestError("Every files field must hold a file");
          const total = files.reduce((sum, file) => sum + file.size, 0);
          if (total > DEGIRO_IMPORT_MAX_BYTES)
            return yield* new DeGiroImportTooLargeError({
              problems: [
                `The upload is ${Math.ceil(total / 1024 / 1024)} MB; the limit is ${DEGIRO_IMPORT_MAX_BYTES / 1024 / 1024} MB`,
              ],
            });
          return yield* Effect.forEach(files, (file) =>
            Effect.tryPromise({
              try: async (): Promise<Upload> => {
                const bytes = await file.arrayBuffer();
                return {
                  filename: file.name,
                  sha256: await sha256Hex(bytes),
                  text: new TextDecoder().decode(bytes),
                };
              },
              catch: () => failedError(`Could not read ${file.name}`),
            }),
          );
        });

      const parseUploads = (uploads: readonly Upload[], asOf: string | undefined) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () =>
              uploads.map((upload) => ({
                upload,
                parsed: parseBrokerFile(
                  upload.filename,
                  upload.text,
                  asOf === undefined ? {} : { asOf },
                ),
              })),
            catch: () => failedError("The uploaded files could not be parsed"),
          });
          if (asOf === undefined && parsed.some(({ parsed: file }) => file.profile === "portfolio"))
            return yield* requestError(
              "A DeGiro portfolio export requires asOf (YYYY-MM-DD): it carries no date column",
            );
          return parsed;
        });

      const readMode = (request: Request) =>
        Effect.gen(function* () {
          const raw = new URL(request.url).searchParams.get("mode") ?? "preview";
          const decoded = Schema.decodeUnknownOption(MODE)(raw);
          if (Option.isNone(decoded)) return yield* requestError(`Unknown mode: ${raw}`);
          return decoded.value;
        });

      const readAsOf = (form: FormData) =>
        Effect.gen(function* () {
          const value = form.get("asOf");
          if (value === null) return undefined;
          if (typeof value !== "string") return yield* requestError("asOf must be a date string");
          const text = value.trim();
          if (text === "") return undefined;
          const decoded = Schema.decodeUnknownOption(ISO_DAY)(text);
          if (Option.isNone(decoded) || !isCalendarDay(decoded.value))
            return yield* requestError("asOf must be a calendar date in YYYY-MM-DD form");
          return decoded.value;
        });

      const readStored = () =>
        Effect.tryPromise({
          try: () => sources.vault.getBrokerData(),
          catch: () => conflictError("The credential vault is locked; unlock it before importing"),
        });

      const importRequest = Effect.fn("DeGiroImport.import")(function* (request: Request) {
        const mode = yield* readMode(request);
        const form = yield* readForm(request);
        const uploads = yield* readUploads(form);
        const asOf = yield* readAsOf(form);
        const parsed = yield* parseUploads(uploads, asOf);
        const files = parsed.map(({ upload, parsed: file }) => fileReport(upload, file));

        if (mode === "preview")
          return { mode: "preview" as const, files } satisfies DeGiroImportResult;

        const result = yield* Effect.tryPromise({
          try: () =>
            createDeGiroFileImport().load({
              files: uploads.map(({ filename, text }): BrokerFileInput => ({ filename, text })),
              entity: sources.entity,
              ...(asOf === undefined ? {} : { asOf }),
            }),
          catch: () => failedError("The DeGiro files could not be imported"),
        });
        /* Nothing parsed means nothing to write: an unknown header, or a known
         * header whose export holds no data row. Importing it would still
         * replace the stored coverage with the file's unknown claim. */
        const hasRows = files.some((file) =>
          Object.values(file.rows).some((rows) => rows.length > 0),
        );
        if (result.source === "" || !hasRows)
          return {
            mode: "commit" as const,
            committed: false,
            files,
            totals: emptyCounts(),
            problems: result.problems,
          } satisfies DeGiroImportResult;

        yield* Effect.tryPromise({
          try: () => sources.vault.ensureWritable(),
          catch: () => conflictError("The credential vault is locked; unlock it before importing"),
        });

        const leaseId = crypto.randomUUID();
        const importedAt = sources.now();
        const staleBefore = DateTime.formatIso(
          DateTime.subtract(DateTime.makeUnsafe(importedAt), {
            milliseconds: BROKER_SYNC_LEASE_TTL_MS,
          }),
        );
        const claim = yield* Effect.tryPromise({
          try: () =>
            sources.operations.claim("degiro", {
              leaseId,
              staleBefore,
              progress: {
                status: "running",
                message: "DeGiro import",
                updatedAt: importedAt,
                leaseId,
              },
            }),
          catch: (cause) => {
            console.error(
              redactProblem(
                `DeGiro import: lease claim failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              ),
            );
            return failedError("The broker lease could not be claimed");
          },
        });
        if (!claim.claimed)
          return yield* conflictError(
            "A DeGiro import or sync is already running; try again when it finishes",
          );

        /* The stored snapshot is read after the claim, never before: two
         * imports arriving together would otherwise merge into the same base
         * and the later write would drop the earlier one. */
        let releaseStatus: BrokerSyncProgressRecord["status"] = "completed";
        const release = () =>
          sources.operations
            .release("degiro", leaseId, {
              status: releaseStatus,
              message:
                releaseStatus === "completed"
                  ? "DeGiro import completed"
                  : "DeGiro import did not complete",
              updatedAt: sources.now(),
              leaseId,
            })
            .catch(() => undefined);

        const write = Effect.gen(function* () {
          const stored = yield* readStored();
          const cache = createBrokerDataCache(stored?.degiro ? { degiro: stored.degiro } : {});
          cache.apply({
            outcomes: [{ broker: "degiro", status: "synced", lastSyncedAt: importedAt, result }],
            problems: result.problems,
          });
          const merged = cache.snapshot().degiro;
          if (!merged) return yield* failedError("The import produced no DeGiro snapshot");
          const snapshot: BrokerAccountSnapshot = {
            ...merged,
            lastImport: {
              importedAt,
              files: uploads.map(({ filename, sha256 }) => ({ filename, sha256 })),
            },
          };
          yield* Effect.tryPromise({
            try: () => sources.vault.putBrokerSnapshot("degiro", snapshot),
            catch: () => failedError("The DeGiro snapshot could not be stored"),
          });
          yield* Effect.tryPromise({
            try: async () => {
              await sources.onCommitted?.(snapshot);
            },
            catch: () => failedError("The DeGiro snapshot was stored but the cache refresh failed"),
          }).pipe(Effect.catch(() => Effect.void));
          return {
            mode: "commit" as const,
            committed: true,
            importedAt,
            files,
            ...(snapshot.cashHistory ? { coverage: snapshot.cashHistory } : {}),
            totals: countRows(snapshot),
            problems: result.problems,
          } satisfies DeGiroImportResult;
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              releaseStatus = "problem";
            }),
          ),
          Effect.ensuring(Effect.promise(release)),
        );

        return yield* write;
      });

      return DeGiroImport.of({ import: importRequest });
    }),
  );
}

export function deGiroImportLayer(
  sources: DeGiroImportSources,
): Layer.Layer<DeGiroImport, never, never> {
  return DeGiroImport.layer.pipe(Layer.provide(Layer.succeed(DeGiroImportSource, sources)));
}

/** The route's shape: one request in, one response out. The tagged error is
 *  mapped here and nowhere else. */
export type DeGiroImportHandler = (request: Request) => Promise<Response>;

function errorResponse(error: DeGiroImportError): Response {
  const body = { problems: error.problems };
  switch (error._tag) {
    case "DeGiroImportRequestError":
      return Response.json(body, { status: 400 });
    case "DeGiroImportTooLargeError":
      return Response.json(body, { status: 413 });
    case "DeGiroImportConflictError":
      return Response.json(body, { status: 409 });
    case "DeGiroImportFailedError":
      return Response.json(body, { status: 500 });
    default:
      return Response.json({ problems: ["The DeGiro import failed"] }, { status: 500 });
  }
}

/** Run the import for one tenant from the imperative Hono route. */
export function createDeGiroImportHandler(sources: DeGiroImportSources): DeGiroImportHandler {
  const runtime = ManagedRuntime.make(deGiroImportLayer(sources));
  return (request) => {
    const program: Effect.Effect<Response, never, DeGiroImport> = DeGiroImport.use((importer) =>
      importer.import(request),
    ).pipe(
      Effect.match({
        onFailure: (error: DeGiroImportError) => errorResponse(error),
        onSuccess: (result) => Response.json(result),
      }),
    );
    return runtime.runPromise(program);
  };
}
