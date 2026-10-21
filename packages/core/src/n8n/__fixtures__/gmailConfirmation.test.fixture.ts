import { existsSync, readFileSync } from "node:fs";

/* Real capture wins; the synthetic one is only a stand-in. The classifier tests
 * read the payload and the expected code from here, so dropping the real file in
 * re-points every test at it with no code change.
 *
 * Second-locale hook: add gmail-forwarding-confirmation.nl.json and/or
 * gmail-forwarding-confirmation.en.json (same shape, same _expectedCode key) and
 * they appear in EXTRA_LOCALE_FIXTURES; setupMail.test.ts runs each one. */
const REAL = new URL("./gmail-forwarding-confirmation.json", import.meta.url);
const SYNTHETIC = new URL("./gmail-forwarding-confirmation.SYNTHETIC.json", import.meta.url);

export const FIXTURE_IS_REAL = existsSync(REAL);

type Fixture = { payload: Record<string, unknown>; expectedCode: string };

function load(url: URL): Fixture {
  const raw = JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
  const { _note: _n, _expectedCode: _c, ...payload } = raw;
  return { payload, expectedCode: String(raw._expectedCode) };
}

const main = load(FIXTURE_IS_REAL ? REAL : SYNTHETIC);

export const EXPECTED_CODE = main.expectedCode;
export const GMAIL_CONFIRMATION_PAYLOAD: Record<string, unknown> = main.payload;

export const EXTRA_LOCALE_FIXTURES: { locale: string; payload: Record<string, unknown>; expectedCode: string }[] =
  ["nl", "en"].flatMap((locale) => {
    const url = new URL(`./gmail-forwarding-confirmation.${locale}.json`, import.meta.url);
    return existsSync(url) ? [{ locale, ...load(url) }] : [];
  });
