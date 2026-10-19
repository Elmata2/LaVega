import { expect, test } from "vitest";
import { domainOf, localPartOf, UNKNOWN_CHECKS } from "../src/authResults.js";

test("no Worker-visible auth result is treated as verified", () => {
  expect(UNKNOWN_CHECKS).toEqual({ spf: "unknown", dkim: "unknown", dmarc: "unknown" });
});

test("domainOf haalt het domein uit een adresheader", () => {
  expect(domainOf("Hosting Noord <facturen@hostingnoord.nl>")).toBe("hostingnoord.nl");
  expect(domainOf("facturen@ing.nl")).toBe("ing.nl");
  expect(domainOf("Facturen@ING.NL.")).toBe("ing.nl");
  expect(domainOf("zonder adres")).toBe("");
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
