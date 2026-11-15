// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { getFxConversionMode, setFxConversionMode } from "./settings";

beforeEach(() => localStorage.clear());

test("never set means convert — that is the stated default", () => {
  expect(localStorage.getItem("lavega.fxConversionMode")).toBeNull();
  expect(getFxConversionMode()).toBe("convert");
});

test("setting separate persists and reads back as separate", () => {
  setFxConversionMode("separate");
  expect(getFxConversionMode()).toBe("separate");
});

test("setting convert after separate flips it back", () => {
  setFxConversionMode("separate");
  setFxConversionMode("convert");
  expect(getFxConversionMode()).toBe("convert");
});

test("uses exactly the lavega.fxConversionMode key", () => {
  setFxConversionMode("separate");
  expect(localStorage.getItem("lavega.fxConversionMode")).toBe("0");
  setFxConversionMode("convert");
  expect(localStorage.getItem("lavega.fxConversionMode")).toBe("1");
});
