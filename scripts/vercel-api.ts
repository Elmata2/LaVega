import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { serverFetch } from "../apps/server/src/index.js";
import { withRuntimeDatabase } from "../apps/investing-server/src/credentialStore.js";

type VercelRequest = IncomingMessage & { body?: unknown };
function requestUrl(req: VercelRequest): string {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}${req.url ?? "/"}`;
}

/**
 * Copy a web body to the Node response chunk by chunk, so SSE still flushes
 * each event.
 *
 * Not `pipeline(Readable.fromWeb(body), res)`: that left eight `close`
 * listeners on `res` per request. Vercel's launcher adds its own, the total
 * reached 11, and Node printed MaxListenersExceededWarning on most requests
 * (#312). This loop adds no `close` listener; the handler's one `onClose` is
 * the only one, and it is removed when the request ends.
 */
async function writeBody(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      if (!res.write(value)) await once(res, "drain", { signal });
    }
    if (!signal.aborted) res.end();
  } catch (error) {
    if (!signal.aborted) res.destroy();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (signal.aborted) cancel();
  }
}

export default async function handler(req: VercelRequest, res: ServerResponse) {
  const abort = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) abort.abort();
  };
  res.on("close", onClose);
  try {
    await withRuntimeDatabase(async () => {
      const response = await serverFetch(
        new Request(requestUrl(req), {
          method: req.method,
          headers: new Headers(
            Object.entries(req.headers).flatMap<[string, string]>(([key, value]) =>
              value == null ? [] : [[key, Array.isArray(value) ? value.join(",") : value]],
            ),
          ),
          body:
            req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
          signal: abort.signal,
        }),
      );

      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        await writeBody(response.body, res, abort.signal);
      } else {
        res.end();
      }
    });
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    res.off("close", onClose);
  }
}
