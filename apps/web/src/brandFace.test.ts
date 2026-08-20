import { expect, test } from "vitest";
import {
  WHITE_MIN_CONTRAST,
  cardRamp,
  contrastWithWhite,
  dominantColor,
  luminance,
  toHex,
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

test("wit blijft leesbaar op elk merk, ook op geel", () => {
  // Geel is het ergste geval: bijna wit van luminantie.
  for (const brand of [
    { r: 255, g: 98, b: 0 }, // ING oranje
    { r: 255, g: 214, b: 0 }, // knalgeel
    { r: 0, g: 82, b: 155 }, // donkerblauw
    { r: 255, g: 255, b: 255 }, // extreem: puur wit
  ]) {
    const ramp = cardRamp(brand);
    for (const stop of [ramp.from, ramp.mid, ramp.to]) {
      const rgb = {
        r: parseInt(stop.slice(1, 3), 16),
        g: parseInt(stop.slice(3, 5), 16),
        b: parseInt(stop.slice(5, 7), 16),
      };
      expect(contrastWithWhite(rgb)).toBeGreaterThanOrEqual(WHITE_MIN_CONTRAST);
    }
  }
});

test("de ramp loopt van donker naar licht, niet omgekeerd", () => {
  const ramp = cardRamp({ r: 255, g: 98, b: 0 });
  const lum = (h: string) =>
    luminance({
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    });
  expect(lum(ramp.from)).toBeLessThan(lum(ramp.mid));
  expect(lum(ramp.mid)).toBeLessThan(lum(ramp.to));
  expect(ramp.gradient).toContain("135deg");
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
