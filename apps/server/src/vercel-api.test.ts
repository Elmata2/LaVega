import { createServer, request } from "node:http";
import { afterEach, expect, test, vi } from "vitest";

const serverFetch = vi.hoisted(() => vi.fn());
const runtimeScope = vi.hoisted(() => ({ active: false, finished: Promise.resolve() }));
vi.mock("./index.js", () => ({ serverFetch }));
vi.mock("../../investing-server/src/credentialStore.js", () => ({
  withRuntimeDatabase: async (run: () => Promise<unknown>) => {
    runtimeScope.active = true;
    runtimeScope.finished = run().then(() => {
      runtimeScope.active = false;
    });
    await runtimeScope.finished;
  },
}));
import handler from "../../../scripts/vercel-api.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.resetAllMocks();
});

async function endpoint() {
  const server = createServer((req, res) => {
    void handler(req, res).catch(() => res.destroy());
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return `http://127.0.0.1:${address.port}/api/agents/portfolio/conversation`;
}

function timeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Stream did not deliver before completion")),
        1000,
      );
      timer.unref();
    }),
  ]);
}

test("delivers SSE before completion and keeps request database scope through final bytes", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  serverFetch.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(value) {
          controller = value;
          controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"First"}\n\n'));
        },
      }),
      { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } },
    ),
  );
  const url = await endpoint();
  const responsePromise = fetch(url);
  try {
    const response = await timeout(responsePromise);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await timeout(reader.read())).value)).toBe(
      'data: {"type":"text-delta","delta":"First"}\n\n',
    );
    expect(runtimeScope.active).toBe(true);
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: [DONE]\n\n");
    expect((await reader.read()).done).toBe(true);
    await timeout(runtimeScope.finished);
    expect(runtimeScope.active).toBe(false);
  } finally {
    try {
      controller.close();
    } catch {
      /* Already completed. */
    }
    await responsePromise.then((response) => response.body?.cancel()).catch(() => {});
  }
});

test.each([
  { status: 401, body: '{"ok":false,"error":"Not logged in"}' },
  { status: 204, body: null },
])("preserves ordinary response status $status, headers, and body", async ({ status, body }) => {
  serverFetch.mockResolvedValue(
    new Response(body, {
      status,
      headers: { "content-type": "application/json", "set-cookie": "session=expired; HttpOnly" },
    }),
  );
  const response = await fetch(await endpoint());
  expect(response.status).toBe(status);
  expect(response.headers.get("set-cookie")).toBe("session=expired; HttpOnly");
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.text()).toBe(body ?? "");
});

test("client disconnect cancels model response and aborts its request", async () => {
  let upstreamRequest!: Request;
  let cancelled!: () => void;
  const cancelledPromise = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  serverFetch.mockImplementation(async (req: Request) => {
    upstreamRequest = req;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: start\n\n"));
        },
        cancel() {
          cancelled();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const url = await endpoint();
  await timeout(
    new Promise<void>((resolve, reject) => {
      const client = request(url, (response) => {
        response.once("data", () => {
          client.destroy();
          resolve();
        });
      });
      client.on("error", reject);
      client.end();
    }),
  );
  await timeout(cancelledPromise);
  expect(upstreamRequest.signal.aborted).toBe(true);
});
