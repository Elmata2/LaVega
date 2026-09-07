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
  expect(
    parseAuthResults("mx; spf=pass header.d=dkim-only.nl smtp.mailfrom=dmarc-test.nl").dkim,
  ).toBe("unknown");
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

import { senderHardFail } from "../src/authResults.js";

/* De poort van M6: alleen een GEMETEN mislukking gaat terug. "Weet ik niet" is
 * geen mislukking — daar zou het hele doorstuuradres op stuklopen, want de
 * comment hierboven geeft zelf toe dat niet vaststaat welke
 * Authentication-Results-header Cloudflare meestuurt. */

test("een nagemaakte afzender (DMARC fail, geen geldige DKIM) wordt geweigerd", () => {
  expect(senderHardFail({ spf: "softfail", dkim: "fail", dmarc: "fail" })).not.toBeNull();
});

test("een harde SPF-fail zonder geldige DKIM wordt geweigerd", () => {
  expect(senderHardFail({ spf: "fail", dkim: "none", dmarc: "unknown" })).not.toBeNull();
});

test("een DOORGESTUURDE mail komt er gewoon door: SPF zakt, DKIM klopt, DMARC houdt stand", () => {
  // Het hoofdgebruik van het doorstuuradres. Sluiten we dit, dan sluiten we de
  // functie.
  expect(senderHardFail({ spf: "fail", dkim: "pass", dmarc: "pass" })).toBeNull();
});

test("DMARC-fail wordt geweigerd, ook als DKIM voor een ANDER domein klopt", () => {
  // Een aanvaller kan zelf DKIM-ondertekenen vanaf zijn eigen domein en toch
  // `From: facturen@ing.nl` zetten. Dan is `dkim=pass` maar `dmarc=fail` — DMARC
  // is de check die het DKIM/SPF-domein aan het From-domein bindt (alignment),
  // dus een DKIM-pass mag een DMARC-fail nooit overrulen.
  expect(senderHardFail({ spf: "softfail", dkim: "pass", dmarc: "fail" })).not.toBeNull();
});

test("geen header gemeten is geen mislukking", () => {
  expect(senderHardFail({ spf: "unknown", dkim: "unknown", dmarc: "unknown" })).toBeNull();
});

test("een domein zonder DMARC- of DKIM-beleid wordt niet weggestuurd", () => {
  expect(senderHardFail({ spf: "pass", dkim: "none", dmarc: "none" })).toBeNull();
});

test("een tijdelijke fout aan onze kant stuurt de afzender niet weg", () => {
  expect(senderHardFail({ spf: "temperror", dkim: "temperror", dmarc: "temperror" })).toBeNull();
});

test("de reden noemt de drie uitslagen, zodat een bounce bruikbaar is", () => {
  const reason = senderHardFail({ spf: "softfail", dkim: "fail", dmarc: "fail" });
  expect(reason).toContain("SPF softfail");
  expect(reason).toContain("DKIM fail");
  expect(reason).toContain("DMARC fail");
});
