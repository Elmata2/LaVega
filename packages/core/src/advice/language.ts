export type AdviceLocale = "nl" | "en";

interface Entry {
  /** What a finding reports. */
  label: string;
  /** Regex sources. Letters are matched case-insensitively with unicode
   *  word-boundaries; spaces match any whitespace run. */
  nl?: readonly string[];
  en?: readonly string[];
  /** Negated forms removed from the text before this entry is matched, so the
   *  legal line ("geen advies", "not advice") can be stated. Only the matched
   *  span is removed; the rest of the text is still checked. */
  allow?: { nl?: readonly string[]; en?: readonly string[] };
  /** Case-sensitive sources applied to both locales (codes, tickers). */
  both?: readonly string[];
}

/** The ONE banned-language list. Information is allowed; telling the user what
 *  to pick or buy is not. Copy tests, plan templates and AI validators import
 *  this; nothing keeps its own list. */
const NL_INSTRUMENT =
  "(?:aandeel|aandelen|fonds|fondsen|etf|etf's|etfs|positie|posities|obligatie|obligaties)";

const NL_PRODUCT = `(?:${NL_INSTRUMENT.slice(3, -1)}|indexfonds(?:en)?|indexfund|\\d+)`;
const EN_PRODUCT = "(?:index funds?|funds?|etfs?|shares|stocks?|bonds?|(?:€|eur\\s*)?\\d+)";

export const ADVICE_LANGUAGE: readonly Entry[] = [
  { label: "best", en: ["best"], nl: ["beste", "best(?:e)? (?:keuze|optie)"] },
  {
    label: "recommend",
    en: ["recommend(?:s|ed|ation|ations|ing)?"],
    nl: [
      "we raden (?:u |je )?aan",
      "wij raden (?:u |je )?aan",
      "ik raad (?:u |je )?aan",
      "aanbevolen",
      "aanbeveling(?:en)?",
    ],
  },
  {
    label: "advice",
    en: ["advice", "advise", "advises", "advised"],
    nl: ["advies", "adviseren", "adviseer", "adviseert"],
    allow: {
      // A colon right after the disclaimer ("Geen advies: spaar meer") means a
      // piece of advice follows, so the allowance does not apply.
      nl: ["geen (?:\\p{L}+ )?advies(?!\\s*:)", "is niet bedoeld als (?:\\p{L}+ )?advies(?!\\s*:)"],
      en: [
        "(?:not|no) (?:\\p{L}+ )?advice(?!\\s*:)",
        "(?:does not|doesn't) constitute (?:\\p{L}+ )?advice(?!\\s*:)",
      ],
    },
  },
  {
    label: "safe",
    en: ["safe", "safer", "safest"],
    nl: ["veilig", "veiliger", "veiligste"],
  },
  { label: "good deal", en: ["good deals?"], nl: ["goede deals?", "gunstige deals?"] },
  { label: "typical", en: ["typical", "typically"], nl: ["typisch", "typische"] },
  {
    label: "people like you",
    en: [
      "(?:people|households|families|investors|savers|users) (?:like|similar to|with (?:your|a similar)) (?:you|yours|your profile)",
      "people (?:in your situation|with your profile)",
    ],
    nl: [
      "(?:mensen|huishoudens|gezinnen|beleggers|sparers|gebruikers) (?:zoals|als) (?:jij|jou|u|het jouwe|het uwe)",
      "(?:mensen|huishoudens|gezinnen) met (?:jouw|uw) (?:profiel|situatie)",
      "mensen in (?:jouw|uw) situatie",
    ],
  },
  {
    label: "buy/sell/hold",
    en: ["buy", "buying", "sell", "selling", "hold", "holding"],
    // Dutch verbs are common in plain sentences ("een buffer aanhouden", "de
    // koop van een huis"), so they only count next to an instrument word.
    nl: [
      `(?:kopen|koop|verkopen|verkoop|aanhouden|houd aan)(?: \\S+){0,3}? ${NL_INSTRUMENT}`,
      `houd(?: \\S+){0,3}? ${NL_INSTRUMENT} aan`,
      `${NL_INSTRUMENT}(?: \\S+){0,3}? (?:kopen|verkopen|aanhouden)`,
    ],
  },
  {
    label: "should",
    en: ["should", "shouldn't", "must"],
    nl: ["moeten", "moet", "zou(?:den)? moeten"],
  },
  {
    label: "invest an amount",
    en: ["invest\\s+(?:€|eur\\s*)?\\s*\\d+", "invest\\s+in\\b", "put\\s+\\d+\\s*%\\s+in"],
    nl: [
      "investeer\\s+(?:€|eur\\s*)?\\s*\\d+",
      "investeer\\s+in\\b",
      "beleg\\s+in\\b",
      "zet\\s+\\d+\\s*%\\s+in",
    ],
  },
  {
    label: "save an amount",
    en: [
      "save\\s+(?:€|eur\\s*)?\\d+",
      "(?:set|put)\\s+(?:€|eur\\s*)?\\d+(?: \\S+){0,3}? aside",
      "(?:set|put) aside(?: \\S+){0,2}? (?:€|eur\\s*)?\\d+",
    ],
    nl: [
      "spaar\\s+(?:€|eur\\s*)?\\d+",
      "(?:zet|leg)(?: \\S+){0,3}? (?:€|eur\\s*)?\\d+(?: \\S+){0,3}? (?:apart|opzij|weg)",
    ],
  },
  {
    label: "suggest",
    en: [
      `(?:we |i )?suggest(?:s|ed|ing)?(?: \\S+){0,3}? ${EN_PRODUCT}`,
      `consider(?:ing)?(?: \\S+){0,3}? ${EN_PRODUCT}`,
    ],
    nl: [
      `overweeg(?:t)?(?: \\S+){0,3}? ${NL_PRODUCT}`,
      "(?:wij|we|ik) stel(?:len)? (?:u |je )?voor",
    ],
  },
  {
    label: "isin",
    both: ["\\b[A-Z]{2}[A-Z0-9]{9}[0-9]\\b"],
  },
  {
    label: "ticker",
    both: ["\\$[A-Z]{1,5}\\b", "\\b(?:NYSE|NASDAQ|AEX|LON|XETRA|EPA|AMS)\\s*:\\s*[A-Z]{1,6}\\b"],
  },
];

const LETTER_OR_DIGIT = "[\\p{L}\\p{N}]";

function wordPattern(source: string, flags = "iu"): RegExp {
  const spaced = source.replace(/ /g, "\\s+");
  return new RegExp(`(?<!${LETTER_OR_DIGIT})(?:${spaced})(?!${LETTER_OR_DIGIT})`, flags);
}

interface Compiled {
  label: string;
  allow: Record<AdviceLocale, RegExp[]>;
  patterns: Record<AdviceLocale, RegExp[]>;
}

const COMPILED: readonly Compiled[] = ADVICE_LANGUAGE.map((e) => ({
  label: e.label,
  allow: {
    nl: (e.allow?.nl ?? []).map((a) => wordPattern(a, "giu")),
    en: (e.allow?.en ?? []).map((a) => wordPattern(a, "giu")),
  },
  patterns: {
    nl: [
      ...(e.nl ?? []).map((s) => wordPattern(s)),
      ...(e.both ?? []).map((s) => new RegExp(s, "u")),
    ],
    en: [
      ...(e.en ?? []).map((s) => wordPattern(s)),
      ...(e.both ?? []).map((s) => new RegExp(s, "u")),
    ],
  },
}));

/** Labels of every banned-language rule `text` trips for `locale`. Word-boundary
 *  aware and case-insensitive ("beste" does not match inside "bestellen";
 *  "hold" does not match inside "household"). Codes and tickers are
 *  case-sensitive. Empty array = clean. */
export function findAdviceLanguage(text: string, locale: AdviceLocale): string[] {
  return COMPILED.filter((c) => {
    const visible = c.allow[locale].reduce((t, re) => t.replace(re, " "), text);
    return c.patterns[locale].some((re) => re.test(visible));
  }).map((c) => c.label);
}
