import type { Locale } from "../locale.js";

/* ALL issuer instructions for "add a card by file", in one place, so a wrong
 * label is corrected here and nowhere else. Keyed by card brand id (the wizard's
 * brand ids); "generic" is the "other bank or card" line.
 *
 * verified: false on every guide. The exact menu labels could not be confirmed
 * from official pages, so the steps are worded to stay true without quoting a
 * label that may differ. Check each guide against the real site/app, then flip
 * `verified` and fix the wording. */
export type ImportGuide = {
  /** False until someone followed the steps on the real site or app. */
  verified: boolean;
  /** At most four short steps. */
  steps: string[];
  /** Where the export works. */
  where: string;
  /** One extra line under the steps on a small screen. */
  phoneNote?: string;
};

export type GuideKey = "amex" | "trading-212" | "generic";

export const IMPORT_GUIDES: Record<GuideKey, Record<Locale, ImportGuide>> = {
  amex: {
    nl: {
      verified: false,
      where: "Via de website van American Express, op je computer.",
      steps: [
        "Log op je computer in op americanexpress.nl.",
        "Open je kaart en ga naar je transacties of afschriften.",
        "Kies de periode die je wilt.",
        "Kies Downloaden en dan CSV (Excel werkt ook).",
      ],
      phoneNote:
        "Op je telefoon lukt deze download meestal niet. Doe dit op je computer en upload het bestand daar.",
    },
    en: {
      verified: false,
      where: "On the American Express website, on a computer.",
      steps: [
        "On a computer, log in at americanexpress.nl.",
        "Open your card and go to your transactions or statements.",
        "Choose the period you want.",
        "Choose Download and then CSV (Excel works too).",
      ],
      phoneNote:
        "On a phone this download usually does not work. Do it on a computer and upload the file there.",
    },
  },
  "trading-212": {
    nl: {
      verified: false,
      where: "In de Trading 212-app.",
      steps: [
        "Open de Trading 212-app.",
        "Ga naar Geschiedenis (History).",
        "Tik op het export- of downloadicoon en kies de periode.",
        "Download het CSV-bestand en kies het hier.",
      ],
    },
    en: {
      verified: false,
      where: "In the Trading 212 app.",
      steps: [
        "Open the Trading 212 app.",
        "Go to History.",
        "Tap the export or download icon and choose the period.",
        "Download the CSV file and choose it here.",
      ],
    },
  },
  generic: {
    nl: {
      verified: false,
      where: "Op de website of in de app van je bank.",
      steps: ["Download een CSV-, Excel- (.xlsx) of MT940-export bij je bank en kies het bestand hier."],
    },
    en: {
      verified: false,
      where: "On your bank's website or in its app.",
      steps: ["Download a CSV, Excel (.xlsx) or MT940 export from your bank and choose the file here."],
    },
  },
};

/** The guide for a card brand; any brand without its own gets the generic line. */
export function guideFor(brand: string | null, locale: Locale): ImportGuide & { key: GuideKey } {
  const key: GuideKey = brand === "amex" || brand === "trading-212" ? brand : "generic";
  return { ...IMPORT_GUIDES[key][locale], key };
}
