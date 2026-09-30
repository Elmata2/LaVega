import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { serverFetch } from "../apps/server/src/index.js";
import { withRuntimeDatabase } from "../apps/investing-server/src/credentialStore.js";

type VercelRequest = IncomingMessage & { body?: unknown };
function requestUrl(req: VercelRequest): string {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}${req.url ?? "/"}`;
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
        await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), res);
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
