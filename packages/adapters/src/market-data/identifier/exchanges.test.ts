import { expect, test } from "vitest";
import { micForOpenFigiExchange, openFigiExchangeForMic } from "./exchanges.js";

test("maps the MICs DeGiro prints to the OpenFIGI exchange codes", () => {
  expect(openFigiExchangeForMic("XAMS")).toBe("NA");
  expect(openFigiExchangeForMic("XLON")).toBe("LN");
  expect(openFigiExchangeForMic("XETR")).toBe("GY");
  expect(openFigiExchangeForMic("XNAS")).toBe("UW");
  expect(openFigiExchangeForMic("XNYS")).toBe("UN");
  expect(openFigiExchangeForMic("XMIL")).toBe("IM");
  expect(openFigiExchangeForMic("XPAR")).toBe("FP");
  expect(openFigiExchangeForMic("XMAD")).toBe("SM");
  expect(openFigiExchangeForMic("XSWX")).toBe("SW");
});

test("tolerates case and surrounding whitespace", () => {
  expect(openFigiExchangeForMic(" xams ")).toBe("NA");
  expect(openFigiExchangeForMic("Xams")).toBe("NA");
});

test("an unknown MIC, a composite code, or no hint is null", () => {
  expect(openFigiExchangeForMic("ZZZZ")).toBeNull();
  expect(openFigiExchangeForMic("")).toBeNull();
  // `US` is an OpenFIGI composite code, not a venue: it must never be a hint.
  expect(openFigiExchangeForMic("US")).toBeNull();
  expect(openFigiExchangeForMic(undefined)).toBeNull();
});

test("maps an exchange code back to its MIC", () => {
  expect(micForOpenFigiExchange("NA")).toBe("XAMS");
  expect(micForOpenFigiExchange(" uw ")).toBe("XNAS");
  expect(micForOpenFigiExchange("US")).toBeNull();
  expect(micForOpenFigiExchange(undefined)).toBeNull();
});
