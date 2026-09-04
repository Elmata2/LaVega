/* Where the owner says he lives — every country, and a region beneath it where
 * the region is its own tax question.
 *
 * Three decisions worth stating:
 *
 * 1. **Never inferred.** No geolocation, no IP lookup, no timezone guess. A
 *    privacy-first app that quietly works out where you are has stopped being
 *    one, so this is typed by hand and only by hand. Nothing here reaches the
 *    network — `Intl.DisplayNames` is a browser API over bundled CLDR data.
 *
 * 2. **The names are not a table we maintain.** The codes are ISO 3166-1
 *    alpha-2 (all 249 officially assigned); the Dutch names come from the
 *    platform, so they cannot drift out of date against a hand-typed list, and
 *    a country never silently disappears because someone forgot to translate
 *    it. If the platform has no name for a code we show the CODE — an honest
 *    "we don't have a name for this" rather than a blank row.
 *
 * 3. **Regions only where we actually know them.** Texas and New York are not
 *    the same tax question, so the US needs a level below the country; so does
 *    Canada. For every other country the region stays a free-text field: we do
 *    not have a verified subdivision list, and inventing one would put a
 *    dropdown of guesses in front of a tax decision. Free text is the honest
 *    control there — he can always type it, we just don't pretend to know it.
 *
 * Pure: no I/O, no clock, no storage. */

/** ISO 3166-1 alpha-2, all 249 officially assigned codes, in code order. */
export const COUNTRY_CODES: readonly string[] = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
];

export type Country = { code: string; name: string };

/** Built once. `Intl.DisplayNames` exists in every browser LaVega targets; the
 *  guard is for an environment that lacks it, where the CODE is the name. */
const displayNames: { of(code: string): string | undefined } | null = (() => {
  try {
    return new Intl.DisplayNames(["nl"], { type: "region" });
  } catch {
    return null;
  }
})();

/** The Dutch name of a country code, or the code itself when the platform has
 *  none — never a blank row, and never a made-up name. */
export function countryName(code: string): string {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  try {
    return displayNames?.of(c) ?? c;
  } catch {
    return c;
  }
}

/** Every country, Dutch name, sorted the way a Dutch reader expects (so "Ålan"
 *  and "Oostenrijk" land where he would look for them). */
export function countryList(): Country[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, "nl"),
  );
}

/* --- The level beneath the country ---------------------------------------
 *
 * Only for the countries where we have a verified subdivision list AND the
 * subdivision genuinely changes the tax answer. Everything else gets a free-text
 * field: no list is better than a list we cannot vouch for. Names are the
 * official ones, not translations — a US return says "New York", not
 * "Nieuw-York". */

const US_STATES: readonly string[] = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
];

const CA_PROVINCES: readonly string[] = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
];

/** Countries whose region level LaVega can offer as a list, with what that
 *  level is CALLED there — a Canadian picks a province, not a state. */
const KNOWN_REGIONS: Readonly<Record<string, { label: string; options: readonly string[] }>> = {
  US: { label: "Staat", options: US_STATES },
  CA: { label: "Provincie of territorium", options: CA_PROVINCES },
};

/** The region options for a country, or [] when we have no verified list — in
 *  which case the field stays free text rather than offering a guess. */
export function regionsFor(code: string): readonly string[] {
  return (
    KNOWN_REGIONS[
      String(code ?? "")
        .trim()
        .toUpperCase()
    ]?.options ?? []
  );
}

/** What the region level is called in this country. The generic fallback is
 *  used wherever we have no list, because "regio" is true everywhere. */
export function regionLabel(code: string): string {
  return (
    KNOWN_REGIONS[
      String(code ?? "")
        .trim()
        .toUpperCase()
    ]?.label ?? "Regio of staat"
  );
}
