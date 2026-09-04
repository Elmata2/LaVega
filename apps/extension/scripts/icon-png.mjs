/* De iconen, met de hand gerekend en als PNG weggeschreven.
 *
 * WAAROM NIET GEWOON EEN PLAATJE ERBIJ ZETTEN. Regel: er wordt tijdens runtime
 * niets opgehaald, en een icoon van internet plukken is precies dat, alleen dan
 * één keer en door mij in plaats van door de extensie. Bundelen tijdens build
 * mag wel, dus wordt het icoon tijdens de build GEMAAKT. Er komt geen byte van
 * buiten deze map in de bundel.
 *
 * WAAROM GEEN SVG. Chrome accepteert in `icons` en `action.default_icon` geen
 * SVG. Dus een echte PNG, en dan maar zelf de encoder: node heeft zlib aan
 * boord en een PNG is niet meer dan een header, een gedeflate byte-blok en een
 * afsluiter. Dat is minder werk dan een afhankelijkheid toevoegen aan een
 * lockfile waar andere lanes in werken.
 *
 * HET MERK. Een donkergroen afgerond vierkant met een lichte pas erin en een
 * donkere magneetstreep. Bij 128 pixels zie je een betaalpas; bij 16 pixels zie
 * je een donker blokje met een lichte balk, en dat is genoeg om het in een rij
 * werkbalkicoontjes terug te vinden. Getest door de 16px-variant uit te
 * schrijven en te bekijken, niet door hem groot te ontwerpen en te hopen. */

import { deflateSync } from "node:zlib";

const GROEN = [0x14, 0x31, 0x2a];
const PAS = [0xf5, 0xf2, 0xea];

/** Tekenafstand tot een afgerond rechthoekje. Negatief = binnen. Met deze ene
 *  functie zijn zowel de achtergrond als de pas te tekenen; dat scheelt twee
 *  bijna-gelijke stukjes code die uit elkaar kunnen lopen. */
function afstand(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const buiten = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return buiten + Math.min(Math.max(dx, dy), 0) - r;
}

/** De kleur op één punt, of null voor doorzichtig. */
function kleurOp(x, y, s) {
  const m = s / 2;
  /* Achtergrond: bijna het hele vlak, met een royale ronding. */
  if (afstand(x, y, m, m, m, m, s * 0.22) > 0) return null;

  /* De pas: liggend, met wat lucht eromheen. */
  const pasHw = s * 0.34;
  const pasHh = s * 0.23;
  const pasR = Math.max(s * 0.05, 1);
  if (afstand(x, y, m, m, pasHw, pasHh, pasR) > 0) return GROEN;

  /* DE STREEP VERVALT ONDER 32 PIXELS, en dat is een meting geweest en geen
   * smaak. Met streep-op-elke-maat gaf de 16px-variant twee even dikke balken
   * met een gat ertussen: op die maat is de pas zeven pixels hoog, dus de streep
   * eet er de helft van op en je ziet een isgelijkteken in plaats van een pas.
   * Onder de 32 blijft de pas daarom dicht — een lichte afgeronde vorm op een
   * donker vlak is klein genoeg om te herkennen en groot genoeg om te zien. */
  if (s >= 32) {
    const streepBoven = m - pasHh * 0.58;
    const streepOnder = m - pasHh * 0.24;
    if (y >= streepBoven && y <= streepOnder) return GROEN;
  }

  return PAS;
}

function crc32(buf) {
  let c;
  const tabel =
    crc32.tabel ??
    (crc32.tabel = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = tabel[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const lengte = Buffer.alloc(4);
  lengte.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lengte, body, crc]);
}

/** Eén PNG als Buffer. `monsters` is de mate van overbemonstering per pixel: 4
 *  betekent 4×4 meetpunten, en dat is wat de randen glad maakt. Zonder dit ziet
 *  de ronding er bij 16 pixels uit als een trap. */
export function maakIcoon(s, monsters = 4) {
  const rijen = Buffer.alloc(s * (s * 4 + 1));
  let p = 0;
  for (let y = 0; y < s; y++) {
    rijen[p++] = 0; // filtertype 0: geen filter
    for (let x = 0; x < s; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < monsters; sy++) {
        for (let sx = 0; sx < monsters; sx++) {
          const k = kleurOp(x + (sx + 0.5) / monsters, y + (sy + 0.5) / monsters, s);
          if (!k) continue;
          r += k[0];
          g += k[1];
          b += k[2];
          a += 255;
        }
      }
      const n = monsters * monsters;
      /* Kleur delen door het aantal RAAKPUNTEN en niet door n: anders wordt een
       * halfdoorzichtige randpixel ook nog eens donkerder gemaakt, en krijg je
       * een vuile rand om het icoon. */
      const raak = a / 255;
      rijen[p++] = raak ? Math.round(r / raak) : 0;
      rijen[p++] = raak ? Math.round(g / raak) : 0;
      rijen[p++] = raak ? Math.round(b / raak) : 0;
      rijen[p++] = Math.round(a / n);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; // bitdiepte
  ihdr[9] = 6; // kleurtype 6 = RGBA
  ihdr[10] = 0; // compressie
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // niet interlaced

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rijen, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const ICOON_MATEN = [16, 32, 48, 128];
