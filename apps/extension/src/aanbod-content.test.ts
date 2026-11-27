// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("aanbod-content retry polling", () => {
  let prevChrome: unknown;
  let sent: AanbodVerzoek[];
  let nextResponse: AanbodAntwoord;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    prevChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
    sent = [];
    nextResponse = { soort: "opnieuw", regel: "nog leeg", noot: "wacht" };

    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: vi.fn(async (msg: AanbodVerzoek) => {
          sent.push(msg);
          return nextResponse;
        }),
      },
    };

    document.documentElement.innerHTML = "<head></head><body></body>";
    window.history.replaceState({}, "", "/offers/eligible");
  });

  afterEach(() => {
    (globalThis as unknown as { chrome?: unknown }).chrome = prevChrome;
    vi.useRealTimers();
    vi.resetModules();
  });

  const scriptPad = "./aanbod-content.js";

  it("breekt geplande herpogingen af bij SPA-navigatie (popstate)", async () => {
    nextResponse = { soort: "opnieuw", regel: "nog leeg", noot: "wacht" };
    await import(scriptPad);

    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ soort: "aanbod-vragen", laatstePoging: false }]);

    window.history.pushState({}, "", "/activity");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(1);
    expect(document.getElementById("lavega-aanbod")).toBeNull();
  });

  it("stuurt laatstePoging=true op de laatste poging en toont de strook", async () => {
    nextResponse = { soort: "opnieuw", regel: "niet gevonden", noot: "klaar" };
    await import(scriptPad);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(9000);

    expect(sent).toEqual([
      { soort: "aanbod-vragen", laatstePoging: false },
      { soort: "aanbod-vragen", laatstePoging: false },
      { soort: "aanbod-vragen", laatstePoging: false },
      { soort: "aanbod-vragen", laatstePoging: true },
    ]);
    expect(document.getElementById("lavega-aanbod")).not.toBeNull();
  });
});
