import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Where a runtime state file lives: INVESTING_*_FILE override wins, else /data in the
 *  Docker tier, else .lavega under the working directory. */
export function runtimeDataFile(envVar: string, fileName: string): string {
  const configured = process.env[envVar]?.trim();
  if (configured) return configured;
  return existsSync("/data") ? join("/data", fileName) : join(process.cwd(), ".lavega", fileName);
}

export type JsonFileStore<T> = {
  read(): Promise<T>;
  /** Serialized read-modify-write: mutations are queued and land atomically (tmp + rename). */
  update(mutate: (current: T) => T): Promise<void>;
};

/**
 * The one durability module for plain-JSON runtime state files. Owns everything
 * callers used to re-implement per store: ENOENT→empty fallback, queued writes,
 * atomic tmp+rename replacement. Corruption policy belongs to `validate` — some
 * stores must refuse bad rows (prices), others must survive them (sync state).
 */
export function createJsonFileStore<T>(
  filePath: string,
  options: { empty: T; validate: (contents: string) => T },
): JsonFileStore<T> {
  let writeQueue = Promise.resolve();

  // ponytail: process-local parse cache; external file edits need a restart.
  let cache: T | null = null;
  let inflight: Promise<T> | null = null;

  const doRead = async (): Promise<T> => {
    let contents: string;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return options.empty;
      throw error;
    }
    cache = options.validate(contents);
    return cache;
  };

  // Single-flight: concurrent callers share one read instead of each loading
  // the whole file (N x fileSize memory spike on large state files).
  const read = (): Promise<T> => {
    if (cache !== null) return Promise.resolve(cache);
    if (!inflight) {
      inflight = doRead().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  const queue = <R>(operation: () => Promise<R>): Promise<R> => {
    const result = writeQueue.then(operation);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const writeValue = async (value: T) => {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value), "utf8");
    await rename(temporaryPath, filePath);
  };

  return {
    read,
    async update(mutate) {
      await queue(async () => {
        const next = mutate(await read());
        cache = next;
        await writeValue(next);
      });
    },
  };
}
