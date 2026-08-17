import { expect, test } from "vitest";
import { localPartOf, parseAuthResults, UNKNOWN_CHECKS } from "../src/authResults.js";

test("de vorm die Cloudflare zet, over meerdere regels uitgevouwen", () => {
  expect(
    parseAuthResults(
      "mx.cloudflare.net; dkim=pass header.d=hostingnoord.nl; spf=pass smtp.mailfrom=hostingnoord.nl; dmarc=pass header.from=hostingnoord.nl",
    ),
  ).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
});

test("een mechanisme dat er niet in staat is 'unknown', niet 'pass' en niet 'none'", () => {
  expect(parseAuthResults("mx.cloudflare.net; spf=pass smtp.mailfrom=x.nl")).toEqual({
    spf: "pass",
    dkim: "unknown",
    dmarc: "unknown",
  });
});

test("geen header betekent drie keer unknown", () => {
  expect(parseAuthResults(null)).toEqual(UNKNOWN_CHECKS);
  expect(parseAuthResults(undefined)).toEqual(UNKNOWN_CHECKS);
  expect(parseAuthResults("   ")).toEqual(UNKNOWN_CHECKS);
});

test("softfail, temperror en permerror worden letterlijk doorgegeven", () => {
  expect(parseAuthResults("mx; spf=softfail; dkim=temperror; dmarc=permerror")).toEqual({
    spf: "softfail",
    dkim: "temperror",
    dmarc: "permerror",
  });
});

test("een uitslag die niet in RFC 7601 staat wordt unknown", () => {
  expect(parseAuthResults("mx; spf=prima; dkim=pass; dmarc=none").spf).toBe("unknown");
});

test("een domeinnaam die op een mechanisme lijkt wordt niet voor een uitslag aangezien", () => {
  // `header.d=dkim-only.nl` mag niet als `dkim=only` gelezen worden.
  expect(parseAuthResults("mx; spf=pass header.d=dkim-only.nl smtp.mailfrom=dmarc-test.nl").dkim).toBe(
    "unknown",
  );
});

test("localPartOf: het lokale deel, in kleine letters", () => {
  expect(localPartOf("Alexander-7F3A@invoices.lavega.dev")).toBe("alexander-7f3a");
  expect(localPartOf("a@b@invoices.lavega.dev")).toBe("a@b");
});

test("localPartOf: zonder @ is er geen sleutel, en die wordt niet verzonnen", () => {
  expect(localPartOf("invoices.lavega.dev")).toBe("");
  expect(localPartOf("@invoices.lavega.dev")).toBe("");
  expect(localPartOf("")).toBe("");
});
