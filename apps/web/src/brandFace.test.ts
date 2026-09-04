import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  CARD_TEXT,
  SHEEN_PEAK_ALPHA,
  WHITE_MIN_CONTRAST,
  cardRamp,
  contrastOnCard,
  contrastWithWhite,
  dominantColor,
  luminance,
  toHex,
  withSheen,
} from "./brandFace.js";

/** Een blokje pixels in één kleur, plus optioneel een witte rand eromheen. */
function pixels(color: [number, number, number], n: number, white = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(color[0], color[1], color[2], 255);
  for (let i = 0; i < white; i++) out.push(255, 255, 255, 255);
  return out;
}

test("de huisstijlkleur wint van het witte vlak waar hij op staat", () => {
  // ING: een oranje boog op wit. Het wit is het grootste oppervlak.
  const ing = dominantColor(pixels([255, 98, 0], 40, 400));
  expect(ing).not.toBeNull();
  expect(toHex(ing!)).toBe("#ff6200");
});

test("een kleurige minderheid verslaat een grijze meerderheid", () => {
  // Een blauw merk met veel antialiasgrijs eromheen.
  const px = [...pixels([0, 82, 155], 30), ...pixels([128, 128, 128], 200)];
  const got = dominantColor(px);
  expect(got).not.toBeNull();
  expect(got!.b).toBeGreaterThan(got!.r);
});

test("een logo zonder kleur geeft null, geen grijs", () => {
  // Zwart-wit logo (SNS-achtig). Null betekent: de kaart houdt zijn eigen tokens.
  expect(dominantColor(pixels([17, 17, 17], 300, 300))).toBeNull();
});

test("doorzichtige pixels tellen niet mee", () => {
  const transparent = [255, 98, 0, 0, 255, 98, 0, 10];
  expect(dominantColor(transparent)).toBeNull();
});

/** Een stop uit de ramp terug naar RGB. */
function rgbOf(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

test("de tekst blijft leesbaar op ELKE stop van elk merk, ook op geel", () => {
  // Geel is het ergste geval: bijna wit van luminantie. Het verloop is breder
  // geworden (vier stops in plaats van drie), dus de toets loopt over `stops` —
  // de hele reeks — en niet meer over drie met de naam erbij. Een verloop
  // verbreden mag nooit betekenen dat er een stop bijkomt die niemand nakijkt.
  for (const brand of [
    { r: 255, g: 98, b: 0 }, // ING oranje
    { r: 255, g: 214, b: 0 }, // knalgeel
    { r: 0, g: 145, b: 100 }, // ABN-groen — stond gemeten op 4,27:1
    { r: 0, g: 82, b: 155 }, // donkerblauw
    { r: 255, g: 255, b: 255 }, // extreem: puur wit
  ]) {
    const ramp = cardRamp(brand);
    expect(ramp.stops.length).toBeGreaterThanOrEqual(4);
    expect(ramp.stops).toContain(ramp.from);
    expect(ramp.stops).toContain(ramp.mid);
    expect(ramp.stops).toContain(ramp.to);
    for (const stop of ramp.stops) {
      // Tegen de kleur die de kaart ECHT print (--on-ink), niet tegen een puur
      // wit dat nergens op het vlak staat...
      expect(contrastOnCard(rgbOf(stop))).toBeGreaterThanOrEqual(WHITE_MIN_CONTRAST);
      // ...en daarmee automatisch ook tegen puur wit, dat lichter is.
      expect(contrastWithWhite(rgbOf(stop))).toBeGreaterThanOrEqual(WHITE_MIN_CONTRAST);
    }
  }
});

test("de toets rekent met de tekstkleur die de kaart echt draagt", () => {
  // .bank-card { color: var(--on-ink) } en die token is #f7f5f0, geen #ffffff.
  expect(toHex(CARD_TEXT)).toBe("#f7f5f0");
  // Gemeten: 8,2% lager dan tegen puur wit. Dat is het gat waardoor het oranje
  // van ING op 4,32:1 uitkwam terwijl de test 4,71 tegen wit zag en slaagde.
  const grens = { r: 199, g: 76, b: 0 };
  expect(contrastOnCard(grens)).toBeLessThan(contrastWithWhite(grens));
  expect(contrastOnCard(rgbOf(cardRamp({ r: 255, g: 98, b: 0 }).to))).toBeGreaterThanOrEqual(
    WHITE_MIN_CONTRAST,
  );
});

test("de ramp loopt van donker naar licht, niet omgekeerd", () => {
  const ramp = cardRamp({ r: 255, g: 98, b: 0 });
  const lum = (h: string) => luminance(rgbOf(h));
  for (let i = 1; i < ramp.stops.length; i++) {
    expect(lum(ramp.stops[i - 1])).toBeLessThan(lum(ramp.stops[i]));
  }
  expect(ramp.from).toBe(ramp.stops[0]);
  expect(ramp.to).toBe(ramp.stops[ramp.stops.length - 1]);
  expect(ramp.gradient).toContain("135deg");
  // De stops staan in het verloop in dezelfde volgorde, elk met zijn positie.
  expect(ramp.gradient.indexOf(ramp.from)).toBeLessThan(ramp.gradient.indexOf(ramp.to));
  expect(ramp.gradient).toContain(`${ramp.to} 100%`);
});

test("het verloop is breder geworden, niet alleen anders verdeeld", () => {
  /* "Make it like a bit more gradient" is meetbaar: het bereik tussen de
   * donkerste en de lichtste stop. De oude donkerste stop stond op −50% van de
   * lichtste, de nieuwe op −72%; dat is het hele verschil, en het zit aan de
   * kant waar het niets kost. */
  const ramp = cardRamp({ r: 31, g: 78, b: 107 });
  const donkerst = rgbOf(ramp.stops[0]);
  const lichtst = rgbOf(ramp.to);
  const oudDonkerst = { r: lichtst.r * 0.5, g: lichtst.g * 0.5, b: lichtst.b * 0.5 };
  expect(luminance(donkerst)).toBeLessThan(luminance(oudDonkerst));
});

test("een donker merk wordt niet onnodig verder verdonkerd", () => {
  // Haalt 4,5:1 al ruim; de lichtste stop hoort dan de kleur zelf te zijn.
  const navy = { r: 0, g: 40, b: 90 };
  expect(cardRamp(navy).to).toBe(toHex(navy));
});

test("bijna-zwarte ruis is geen huisstijlkleur", () => {
  /* Dit is gemeten, geen bedacht geval: het zwarte Trading 212-logo leverde
   * #000000 op MET verzadiging 1,00, omdat verzadiging schaalonafhankelijk is —
   * (1,0,0) is net zo "verzadigd rood" als (255,0,0). Een zwart logo hoort geen
   * kleur te hebben, en dus zijn tokenvlak te houden. */
  const noise: number[] = [];
  for (let i = 0; i < 400; i++) noise.push(2, 1, 0, 255);
  expect(dominantColor(noise)).toBeNull();
});

test("een donkere maar echte huisstijlkleur blijft wel staan", () => {
  // ICS is #0e1844 — donker, maar helder genoeg om een kleur te zijn.
  const ics: number[] = [];
  for (let i = 0; i < 200; i++) ics.push(14, 24, 68, 255);
  const got = dominantColor(ics);
  expect(got).not.toBeNull();
  expect(toHex(got!)).toBe("#0e1844");
});

test("wit blijft leesbaar ONDER de glans, niet alleen ernaast", () => {
  /* De glans is het enige dat de kaart lichter maakt, en hij zit precies onder de
   * cursor — dus precies waar iemand leest. Tot deze test bestond gold de 4,5:1
   * voor de kaart zoals hij er ZONDER glans uitziet; een schermafdruk zou dat
   * nooit laten zien, want de glans verschijnt alleen tijdens hover. */
  for (const brand of [
    { r: 255, g: 105, b: 1 }, // ING, gemeten
    { r: 0, g: 167, b: 226 }, // Trading 212, gemeten
    { r: 159, g: 232, b: 112 }, // Wise, het lichtste merk dat we hebben
    { r: 255, g: 214, b: 0 }, // knalgeel
    { r: 255, g: 255, b: 255 }, // extreem: puur wit
  ]) {
    const ramp = cardRamp(brand);
    for (const stop of ramp.stops) {
      const rgb = {
        r: parseInt(stop.slice(1, 3), 16),
        g: parseInt(stop.slice(3, 5), 16),
        b: parseInt(stop.slice(5, 7), 16),
      };
      expect(contrastOnCard(withSheen(rgb))).toBeGreaterThanOrEqual(WHITE_MIN_CONTRAST);
    }
  }
});

test("de glans in de CSS is niet sterker dan waar de ramp op rekent", () => {
  /* Twee plekken die hetzelfde getal moeten dragen, en de CSS is de plek waar
   * iemand het per ongeluk mooier zet. Gaat de alpha daar omhoog zonder dat
   * SHEEN_PEAK_ALPHA meebeweegt, dan klopt de hele contrastgarantie niet meer —
   * en dan valt hier een test om in plaats van dat niemand het merkt. */
  const css = readFileSync(new URL("./styles/blocks.css", import.meta.url), "utf8");
  const sheen = css.slice(css.indexOf(".bank-card-sheen"));
  const alphas = [...sheen.slice(0, 900).matchAll(/rgba?\([^)]*?([01]?\.\d+)\s*\)/g)].map((m) =>
    Number(m[1]),
  );
  expect(alphas.length).toBeGreaterThan(0);
  expect(Math.max(...alphas)).toBeLessThanOrEqual(SHEEN_PEAK_ALPHA);
});
