/* De misbruikgrens per wachtrij. Twee paden die even belangrijk zijn: de grens
 * die WEL telt (een benoemde weigering, geen stille drop) en de grens die niet
 * werkt (fail open, één regel in het log, mail gaat door).
 */

import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { handleInboundEmail } from "../src/handler.js";
import {
  INBOUND_LIMIT,
  INBOUND_PERIOD_SECONDS,
  allowQueueMessage,
  resetLimiterWarning,
} from "../src/queueLimit.js";
import { fakeFetch, fakeMessage } from "./fakeMessage.js";
import { RAW_PLAIN_TEXT } from "./rawMail.js";

const ENV = {
  N8N_WEBHOOK_URL: "https://n8n.example/webhook/lavega-mail-in",
  N8N_SHARED_SECRET: "geheim-123",
};
const QUEUED = { addedInvoices: 1, addedNotices: 0, inQueue: 1, noticesInQueue: 0 };

beforeEach(() => {
  resetLimiterWarning();
});

test("de grens telt per wachtrij, en bij overschrijding volgt een benoemde weigering", async () => {
  const keys: string[] = [];
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(
    message,
    {
      ...ENV,
      INBOUND_RATE_LIMIT: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: false };
        },
      },
    },
    { fetch: http.fetch },
  );

  expect(keys).toEqual(["alexander-7f3a"]);
  expect(verdict.kind).toBe("reject");
  expect(verdict.kind === "reject" && verdict.reason).toContain("alexander-7f3a");
  expect(verdict.kind === "reject" && verdict.reason).toContain("opnieuw door");
  expect(verdict.kind === "reject" && verdict.reason).toContain(
    INBOUND_LIMIT + " berichten per " + INBOUND_PERIOD_SECONDS,
  );
  // Niets ging naar n8n: de mail is niet verwerkt en de afzender hoort dat.
  expect(http.calls).toEqual([]);
});

test("onder de grens gaat de mail gewoon naar de wachtrij", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(
    message,
    { ...ENV, INBOUND_RATE_LIMIT: { limit: async () => ({ success: true }) } },
    { fetch: http.fetch },
  );

  expect(verdict.kind).toBe("queued");
  expect(http.calls).toHaveLength(1);
});

test("een binding die gooit laat de mail door en logt de reden één keer", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const env = {
    ...ENV,
    INBOUND_RATE_LIMIT: {
      limit: async () => {
        throw new Error("binding unavailable");
      },
    },
  };
  const http = fakeFetch({ body: QUEUED });

  const first = await handleInboundEmail(fakeMessage({ raw: RAW_PLAIN_TEXT }), env, {
    fetch: http.fetch,
  });
  const second = await handleInboundEmail(fakeMessage({ raw: RAW_PLAIN_TEXT }), env, {
    fetch: http.fetch,
  });

  expect(first.kind).toBe("queued");
  expect(second.kind).toBe("queued");
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toContain("INBOUND_RATE_LIMIT");
  expect(String(warn.mock.calls[0][0])).toContain("binding unavailable");
  expect(String(warn.mock.calls[0][0])).toContain("niet begrensd");
  warn.mockRestore();
});

test("een ontbrekende binding laat de mail door, met één regel in het log", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(fakeMessage({ raw: RAW_PLAIN_TEXT }), ENV, {
    fetch: http.fetch,
  });

  expect(verdict.kind).toBe("queued");
  expect(http.calls).toHaveLength(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toContain("ontbreekt");
  warn.mockRestore();
});

test("een verkeerd gedeclareerde binding geldt als ontbrekend, niet als weigering", async () => {
  const outcome = await allowQueueMessage(
    {} as unknown as { limit(input: { key: string }): Promise<{ success: boolean }> },
    "alexander-7f3a",
    () => {},
  );

  expect(outcome.kind).toBe("allowed");
});

test("wrangler.toml en queueLimit.ts noemen dezelfde grens", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const block = toml.match(/\[\[ratelimits\]\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";

  expect(block).toContain('name = "INBOUND_RATE_LIMIT"');
  expect(block).toMatch(/namespace_id\s*=\s*"\d+"/);
  expect(block).toContain("limit = " + INBOUND_LIMIT);
  expect(block).toContain("period = " + INBOUND_PERIOD_SECONDS);
});
