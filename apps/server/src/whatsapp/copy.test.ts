import { expect, test } from "vitest";
import { FRAMING_PHRASES, WHATSAPP_COPY } from "./copy.js";

/* The consent reply names a screen of the web app. The name is read from the web shell by
 * path (the web package is not a dependency of the server), so the two cannot drift. */
const WEB_SHELL = new URL("../../../web/src/copy/shell.ts", import.meta.url).pathname;

test("the consent reply names the Meldingen / Alerts screen exactly as the web shell does", async () => {
  const { shellCopy } = (await import(/* @vite-ignore */ WEB_SHELL)) as {
    shellCopy: Record<"nl" | "en", { topBar: { viewTitles: { meldingen: string } } }>;
  };
  expect(WHATSAPP_COPY.nl.consentOutdated).toContain(
    `bij ${shellCopy.nl.topBar.viewTitles.meldingen}.`,
  );
  expect(WHATSAPP_COPY.en.consentOutdated).toContain(
    `under ${shellCopy.en.topBar.viewTitles.meldingen}.`,
  );
  expect(shellCopy.en.topBar.viewTitles.meldingen).toBe("Alerts");
});

test("the phrase lists are as long, in the same order, in both languages", () => {
  expect(FRAMING_PHRASES.nl.intros).toHaveLength(6);
  expect(FRAMING_PHRASES.nl.outros).toHaveLength(5);
  expect(FRAMING_PHRASES.en.intros).toHaveLength(FRAMING_PHRASES.nl.intros.length);
  expect(FRAMING_PHRASES.en.outros).toHaveLength(FRAMING_PHRASES.nl.outros.length);
});
