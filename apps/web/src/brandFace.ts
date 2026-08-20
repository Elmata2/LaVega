/* De kleur van een kaart, afgeleid uit het logo dat we al hebben.
 *
 * ZIJN VRAAG WAS: de echte kaart nadoen, of een gradient in de kleur van het
 * logo. Dit is de tweede, en het waarom staat hier omdat het een keuze is:
 *
 *  - Een logo gebruiken om het product te BENOEMEN waar het over gaat is een
 *    gangbaar gebruik (met de disclaimer in TRADEMARKS.md). De ARTWORK van een
 *    kaart natekenen is iets anders: dat is een ontwerp overnemen, en daarvoor
 *    bestaat die rechtvaardiging niet.
 *  - Er zijn 122 producten. Echte kaartafbeeldingen zijn 122 plaatjes, elk met
 *    eigen herkomst, en elk kilobytes in de bundel — voor decoratie.
 *  - De logo's zitten er AL in. Er wordt dus niets opgehaald, er komt geen byte
 *    bij, en een ING-kaart wordt oranje omdat het ING-logo oranje IS.
 *
 * De extractie zelf gebeurt in de browser uit de gebundelde data-URI
 * (brandColors.ts) — nooit uit een verzoek naar de bank. Dit bestand bevat het
 * pure deel: van pixels naar een kleur, en van een kleur naar een kaartvlak.
 *
 * WIT MOET LEESBAAR BLIJVEN, en dat is geen smaak maar een regel. Een logo mag
 * zo licht zijn als het wil (geel, lichtblauw); de ramp wordt daarom net zo lang
 * verdonkerd tot wit erop 4,5:1 haalt. Zo is er nooit een kaart waar het saldo
 * wegvalt in zijn eigen huisstijl. */

export type Rgb = { r: number; g: number; b: number };

/** Doorzichtig genoeg om achtergrond te zijn. */
const MIN_ALPHA = 128;
/** Bijna-wit is het papier waar het logo op staat, niet de huisstijl. */
const NEAR_WHITE = 240;
/** ...en bijna-zwart is inkt, geen huisstijlkleur. Deze grens is nodig omdat
 *  verzadiging SCHAALONAFHANKELIJK is: (1,0,0) is net zo "volledig verzadigd
 *  rood" als (255,0,0). Zonder deze drempel wint de antialiasruis rond een zwart
 *  logo de kleurtoets, en dan kreeg Trading 212 #000000 toegewezen als ware het
 *  een huisstijlkleur — gemeten, niet bedacht. */
const MIN_BRIGHTNESS = 48;
/** WCAG AA voor normale tekst. Het saldo staat op 0,85rem — dus 4,5, niet 3. */
export const WHITE_MIN_CONTRAST = 4.5;

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Verzadiging volgens HSL — hoe "kleurig" iets is, los van hoe licht. */
export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2 / 255;
  const d = (max - min) / 255;
  return l > 0.5 ? d / (2 - max / 255 - min / 255) : d / (max / 255 + min / 255);
}

/** Relatieve luminantie (WCAG 2.x). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast tussen wit en deze kleur. */
export function contrastWithWhite(rgb: Rgb): number {
  return 1.05 / (luminance(rgb) + 0.05);
}

/** Vermenigvuldigen naar donkerder (f<0) of lichter (f>0). */
export function shade(rgb: Rgb, f: number): Rgb {
  if (f < 0) {
    const k = 1 + f;
    return { r: rgb.r * k, g: rgb.g * k, b: rgb.b * k };
  }
  return {
    r: rgb.r + (255 - rgb.r) * f,
    g: rgb.g + (255 - rgb.g) * f,
    b: rgb.b + (255 - rgb.b) * f,
  };
}

/** De dominante huisstijlkleur uit RGBA-pixels, of null.
 *
 *  Null is een echt antwoord: een logo dat alleen zwart en wit is (SNS, sommige
 *  favicons) HEEFT geen kleur, en dan houdt de kaart zijn eigen tokens. Een grijs
 *  vlak verkopen als huisstijl zou een verzinsel zijn.
 *
 *  Pixels worden per 16 niveaus gebundeld — anders is elke antialiasrand een
 *  eigen kleur en wint niemand. Binnen de winnende bak wordt het gemiddelde van
 *  de echte pixels teruggegeven, zodat de kleur niet naar een rasterpunt springt.
 *
 *  Kleurige bakken wegen zwaarder dan grote grijze bakken: een oranje ING-boog
 *  op een wit vierkant is minder oppervlak dan de rand eromheen, maar het IS de
 *  huisstijl. */
export function dominantColor(pixels: ArrayLike<number>): Rgb | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < MIN_ALPHA) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = bins.get(key);
    if (cur) {
      cur.n += 1;
      cur.r += r;
      cur.g += g;
      cur.b += b;
    } else {
      bins.set(key, { n: 1, r, g, b });
    }
  }
  if (bins.size === 0) return null;

  // ALLEEN de kleurige bakken doen mee, en dat is het hele punt. Eerst won de
  // grootste bak en werd die daarna afgekeurd omdat hij grijs was — dus een
  // logo met veel antialiasgrijs om een klein blauw merkje leverde NULL op,
  // terwijl de kleur er wel is. De vraag is niet "wat is het grootste vlak"
  // maar "welke KLEUR is dit merk": grijs en zwart zijn geen kandidaten, hoe
  // veel oppervlak ze ook hebben.
  let best: Rgb | null = null;
  let bestScore = 0;
  for (const bin of bins.values()) {
    const mean = { r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n };
    const sat = saturation(mean);
    if (sat < 0.15) continue;
    if (Math.max(mean.r, mean.g, mean.b) < MIN_BRIGHTNESS) continue;
    const score = bin.n * (1 + 4 * sat);
    if (score > bestScore) {
      bestScore = score;
      best = mean;
    }
  }
  // Geen enkele kleurige bak: dit logo HEEFT geen huisstijlkleur (zwart-wit).
  if (best === null) return null;
  return { r: Math.round(best.r), g: Math.round(best.g), b: Math.round(best.b) };
}

export type CardRamp = { from: string; mid: string; to: string; gradient: string };

/** Het kaartvlak voor een huisstijlkleur.
 *
 *  De LICHTSTE stop wordt eerst verdonkerd tot wit erop 4,5:1 haalt; de andere
 *  twee zijn daar afgeleiden van en dus per definitie donkerder. Zo hoeft de
 *  tekstkleur nooit per kaart te wisselen. */
export function cardRamp(brand: Rgb): CardRamp {
  let top = brand;
  // Ruim genoeg om vanaf puur wit onder de grens te komen; stopt zodra het klopt.
  for (let i = 0; i < 40 && contrastWithWhite(top) < WHITE_MIN_CONTRAST; i++) {
    top = shade(top, -0.08);
  }
  const from = toHex(shade(top, -0.5));
  const mid = toHex(shade(top, -0.2));
  const to = toHex(top);
  return {
    from,
    mid,
    to,
    gradient: `linear-gradient(135deg, ${from} 0%, ${mid} 55%, ${to} 100%)`,
  };
}
