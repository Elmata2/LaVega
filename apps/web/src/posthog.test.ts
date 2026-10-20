import { describe, expect, test } from "vitest";
import type { CaptureResult } from "posthog-js";
import { scrubPostHogEvent } from "./posthog.js";

/* What leaves for PostHog. The sanitizer is an allowlist that drops every
 * property it does not name, so these tests are about the GRENS: a financial
 * string that reaches a property must not survive the rebuild. */

function capture(properties: Record<string, unknown>, event = "$pageview"): CaptureResult {
  return { uuid: "u-1", event, properties } as unknown as CaptureResult;
}

describe("scrubPostHogEvent", () => {
  test("drops every property it does not name, financial strings included", () => {
    const out = scrubPostHogEvent(
      capture({
        amountCents: 4999,
        iban: "NL02ABNA0123456789",
        counterparty: "Alexander Steunenberg",
        "parse-error-body": '{"bedrag":1240,"username":"x@y.nl"}',
        $lib: "web",
      }),
    );
    expect(Object.keys(out.properties).sort()).toEqual(["$lib"]);
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("4999");
    expect(serialised).not.toContain("NL02ABNA");
    expect(serialised).not.toContain("Steunenberg");
    expect(serialised).not.toContain("x@y.nl");
  });

  test("keeps the device field that diagnoses a crash ($os)", () => {
    const out = scrubPostHogEvent(capture({ $lib: "web", $os: "Mac OS X" }));
    expect(out.properties.$os).toBe("Mac OS X");
  });

  test("strips query and hash from a URL and masks id-like path segments", () => {
    const out = scrubPostHogEvent(
      capture({
        $current_url: "https://lavega.dev/app?rekening=NL02ABNA0123456789#bedrag=4999",
        $pathname: "/app/transfer/abc123",
        $host: "lavega.dev",
      }),
    );
    expect(out.properties.$current_url).toBe("https://lavega.dev/app");
    expect(out.properties.$pathname).toBe("/app/transfer/:id");
    expect(out.properties.$host).toBe("lavega.dev");
  });

  test("drops a referrer it cannot read as an address instead of forwarding it", () => {
    const out = scrubPostHogEvent(capture({ $referrer: "$direct" }));
    expect(out.properties.$referrer).toBeUndefined();
  });

  test("drops free-form exception text and frame names", () => {
    const out = scrubPostHogEvent(
      capture(
        {
          $exception_list: [
            {
              type: "Error",
              value: 'Unexpected token, body: {"iban":"NL02ABNA0123456789"}',
              mechanism: { type: "onerror", handled: false },
              stacktrace: {
                frames: [
                  {
                    filename: "https://lavega.dev/assets/vault.js?bedrag=4999",
                    function: "pay",
                    lineno: 12,
                    colno: 4,
                    in_app: true,
                  },
                ],
              },
            },
          ],
          $exception_message: "transfer € 4.999,00 to Alexander failed",
        },
        "$exception",
      ),
    );
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("NL02ABNA");
    expect(serialised).not.toContain("4.999");
    expect(serialised).not.toContain("4999");
    expect(serialised).not.toContain("Alexander");
    expect(serialised).not.toContain("vault.js");
    expect(out.properties.$exception_message).toBeUndefined();
    expect(out.properties.$exception_list).toEqual([
      {
        type: "Error",
        mechanism: { type: "onerror", handled: false },
        stacktrace: {
          frames: [
            {
              lineno: 12,
              colno: 4,
              in_app: true,
            },
          ],
        },
      },
    ]);
  });

  test("drops a SyntaxError message, which quotes the input it failed on", () => {
    const out = scrubPostHogEvent(
      capture(
        {
          $exception_list: [
            { type: "SyntaxError", value: 'Unexpected token "x" in JSON at position 4' },
          ],
        },
        "$exception",
      ),
    );
    expect(out.properties.$exception_list).toEqual([{ type: "SyntaxError" }]);
  });

  test("drops amountCents and counterparty from a product event", () => {
    const out = scrubPostHogEvent(
      capture(
        {
          direction: "outgoing",
          amountCents: 4999,
          counterparty: "JBL",
        },
        "invoice_added",
      ),
    );
    expect(out.properties.amountCents).toBeUndefined();
    expect(out.properties.counterparty).toBeUndefined();
  });

  test("never carries person properties or autocaptured DOM elements", () => {
    const base = capture({ $lib: "web" });
    const out = scrubPostHogEvent({
      ...base,
      $set: { email: "x@y.nl", plan: "pro" },
      $set_once: { first_seen: "2026-01-01" },
      $unset: ["email"],
      properties: { ...base.properties, $elements: [{ text: "Bedrag: € 4.999" }] },
    } as unknown as CaptureResult);
    expect(Object.keys(out.properties)).toEqual(["$lib"]);
    expect(out.$set).toBeUndefined();
    expect(out.$set_once).toBeUndefined();
    expect(out.$unset).toBeUndefined();
  });
});
