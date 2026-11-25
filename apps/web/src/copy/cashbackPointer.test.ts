import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../archive");
  vi.resetModules();
});

const texts = async () => {
  const { optimiseCopy } = await import("./optimise.js");
  return (["nl", "en"] as const).flatMap((l) => {
    const c = optimiseCopy[l].optimalisatie.cashback;
    return [
      c.openGapsSentence("Kaart X"),
      c.onderbouwing.assumedNote({ bankOrProduct: "ING", checkedNote: "", dueForReview: false }),
      c.heldCashback.assumptionOff,
    ];
  });
};

test("while the Cashback corrigeren card is hidden, no text points to it", async () => {
  for (const t of await texts()) expect(t).not.toMatch(/Cashback corrigeren|Correct cashback/);
});

test("when the card is shown, the texts point to it again", async () => {
  vi.resetModules();
  vi.doMock("../archive", async (orig) => ({
    ...(await orig<typeof import("../archive")>()),
    SHOW_CASHBACK_CORRECTION: true,
  }));
  for (const t of await texts()) expect(t).toMatch(/Cashback corrigeren|Correct cashback/);
});
