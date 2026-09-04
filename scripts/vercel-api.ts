import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../apps/server/src/index.js";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  send(body: Buffer): void;
};

function requestUrl(req: VercelRequest): string {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}${req.url ?? "/"}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const response = await app.fetch(
    new Request(requestUrl(req), {
      method: req.method,
      headers: new Headers(
        Object.entries(req.headers).flatMap(([key, value]) =>
          value == null ? [] : [[key, Array.isArray(value) ? value.join(",") : value]],
        ),
      ),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
    }),
  );

  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await response.arrayBuffer()));
}
