/* Huisstijlkleuren uit de GEBUNDELDE logo's, in de browser.
 *
 * Waarom hier en niet in de sweep: de bundel bevat png, svg en ico door elkaar
 * heen (favicons zijn wat de bank aanbiedt, niet wat wij kiezen). De browser
 * decodeert alle drie al; in Node zou elk formaat een eigen decoder vragen. En
 * er is geen privacyverschil, want de bron is een data-URI — er gaat geen
 * verzoek naar buiten, ook niet naar de bank.
 *
 * Eenmalig per sessie, in een module-cache: veertien logo's van 32 px kosten
 * niets, maar per kaart opnieuw decoderen bij elke render wel. */
import { BANK_LOGOS, type BankLogo } from "./assets/bank-logos.generated.js";
import { cardRamp, dominantColor, type CardRamp } from "./brandFace.js";

/** Klein genoeg om gratis te zijn, groot genoeg om een dun logo te raken. */
const SAMPLE = 48;

/** Slug → kaartvlak. Een slug die hier NIET in staat heeft geen kleur, en dan
 *  houdt de kaart zijn eigen tokens. */
export type BrandRamps = Record<string, CardRamp>;

let cached: Promise<BrandRamps> | null = null;

function decode(logo: BankLogo): Promise<CardRamp | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Een SVG zonder width/height heeft geen eigen maat; drawImage tekent dan
    // niets. Een expliciete maat geeft hem er een.
    img.width = SAMPLE;
    img.height = SAMPLE;
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const ctx = canvas.getContext("2d", { willReadFrequently: false });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
        const brand = dominantColor(data);
        resolve(brand ? cardRamp(brand) : null);
      } catch {
        // Een canvas die niet uitgelezen kan worden is een kleur die we niet
        // kennen — precies zoals een logo dat we niet konden lezen.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logo.dataUri;
  });
}

/** Alle kaartvlakken, één keer per sessie. */
export function loadBrandRamps(logos: BankLogo[] = BANK_LOGOS): Promise<BrandRamps> {
  if (cached) return cached;
  cached = Promise.all(logos.map((l) => decode(l).then((r) => [l.slug, r] as const))).then((pairs) => {
    const out: BrandRamps = {};
    for (const [slug, ramp] of pairs) if (ramp) out[slug] = ramp;
    return out;
  });
  return cached;
}
