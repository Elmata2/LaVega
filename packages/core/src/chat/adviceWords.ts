/* A WORD CHECK for product and investment advice in the chat's answers. It is not an
 * advice filter: it catches the phrases that tell a person what to buy, sell, open,
 * cancel or switch, and nothing else. The shared list (`findAdviceLanguage`) was built
 * for static plan copy and flags ordinary sentences about bills and spending ("je moet
 * nog € 132,50 betalen": "moet"; "typisch", "veilig", English "must"), so the chat has
 * its own. Bare modal verbs and adjectives are NOT triggers here; an investment or
 * switching verb next to an advising phrase is. */

const NL = [
  String.raw`\bik raad\b`,
  String.raw`\b(?:mijn|ons) (?:advies|aanbeveling)\b`,
  String.raw`\bik (?:adviseer|beveel)\b`,
  String.raw`\bik stel (?:je )?voor\b`,
  String.raw`\b(?:koop|kopen|verkoop|verkopen|beleg|beleggen|investeer|investeren|houd)\b[^.!?]{0,40}\b(?:aandelen|aandeel|etf'?s?|fonds|fondsen|indexfonds|indexfondsen|crypto|bitcoin|obligaties?|beleggingsfonds)\b`,
  String.raw`\b(?:aandelen|aandeel|etf'?s?|fondsen|indexfonds|crypto|bitcoin|obligaties?)\b[^.!?]{0,30}\b(?:kopen|verkopen|aanhouden)\b`,
  String.raw`\bje (?:zou|moet|kunt|kan)\b[^.!?]{0,40}\b(?:het beste|beter)\b`,
  String.raw`\b(?:de|het) beste (?:product|keuze|optie|deal|rekening|kaart|aanbieder|spaarrekening)\b`,
  String.raw`\bdat is het beste\b`,
  String.raw`\bje (?:zou|moet)\b[^.!?]{0,40}\b(?:beleggen|investeren|opzeggen|overstappen|afsluiten)\b`,
  String.raw`\bsluit\b[^.!?]{0,30}\baf\b`,
  String.raw`\bzeg\b[^.!?]{0,20}\bop\b`,
  String.raw`\boverweeg\b`,
];

const EN = [
  String.raw`\bi (?:recommend|suggest|advise)\b`,
  String.raw`\bmy (?:advice|recommendation)\b`,
  String.raw`\byou should\b[^.!?]{0,30}\b(?:buy|sell|invest|cancel|switch|open|close|move|put|save)\b`,
  String.raw`\b(?:buy|sell|invest in)\b[^.!?]{0,30}\b(?:shares|stocks?|etfs?|funds?|index funds?|crypto|bitcoin|bonds)\b`,
  String.raw`\bthe best (?:product|choice|option|card|deal|account)\b`,
  String.raw`\bconsider (?:buying|switching|investing|cancel(?:l)?ing)\b`,
];

const PATTERNS = [...NL, ...EN].map((source) => new RegExp(source, "iu"));

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Blank each data string where it stands WHOLE (not inside another word): a name quoted
 *  from the owner's own data is data, not the model's advice. */
export function maskDataNames(text: string, names: readonly string[]): string {
  return names.reduce(
    (t, name) =>
      t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "giu"), " "),
    text,
  );
}

/** Which pattern sources the text trips; empty = clean. */
export function adviceHits(text: string): string[] {
  return PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}
