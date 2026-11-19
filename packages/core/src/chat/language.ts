import type { ChatLocale } from "./view.js";

/* Which language the answer should be in. A small model drifts to the language
 * of the tool results (Dutch category names, Dutch money text) and of the prompt,
 * so the APP decides from the user's own words and tells the model. A pure
 * word-list vote: no network, no model. Ties and no-words fall back to the
 * interface language. */

const EN = new Set(
  `what whats how which where when why who did do does is are was were am can could should would will my me i you your the a an of in on for to and or this that last next month week year day today yesterday tomorrow spend spent much many have has had show list tell give see total balance balances subscriptions bills spending money account accounts pay paid payments payment transactions biggest most from with about there any all`.split(
    /\s+/,
  ),
);
const NL = new Set(
  `wat welke welk hoe hoeveel waar waarom wanneer wie heb heeft hebben ik jij je mijn mij ons de het een van in op voor naar en of dit dat deze die vorige volgende maand week jaar dag vandaag gisteren morgen uit uitgegeven gaf betaald betaalde kan kun mag moet zijn is was waren zit staat toon laat zie alle alles totaal saldo saldos saldo's abonnementen rekeningen rekening uitgaven betalingen grootste meeste bij met over er geen niet ook nog maar wel`.split(
    /\s+/,
  ),
);
// Words both languages use: they carry no vote.
const SHARED = new Set(["in", "is", "a", "am", "of", "na"]);

/** A word without its leading and trailing apostrophes, by a plain scan. */
function trimQuotes(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && word[start] === "'") start += 1;
  while (end > start && word[end - 1] === "'") end -= 1;
  return word.slice(start, end);
}

export function detectChatLanguage(text: string, fallback: ChatLocale): ChatLocale {
  let en = 0;
  let nl = 0;
  for (const raw of text.toLowerCase().split(/[^\p{L}']+/u)) {
    const w = trimQuotes(raw);
    if (w === "" || SHARED.has(w)) continue;
    if (EN.has(w)) en += 1;
    if (NL.has(w)) nl += 1;
  }
  if (en > nl) return "en";
  if (nl > en) return "nl";
  return fallback;
}
