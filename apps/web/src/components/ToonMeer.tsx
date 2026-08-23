import type { ReactNode } from "react";

/* TOON MEER — het antwoord vooraan, de onderbouwing opgevouwen.
 *
 * LaVega verantwoordt elk cijfer met bron, datum en voorwaarden. Die
 * verantwoording blijft volledig; ze staat alleen niet meer standaard open,
 * want een scherm dat zijn hele bewijslast tegelijk toont leest als een
 * document en niet als een antwoord.
 *
 * ── GEBRUIK ───────────────────────────────────────────────────────────────
 *
 *   // 1. "regel" (de standaard): een volle regel onder een blok.
 *   <ToonMeer summary="Waar dit cijfer vandaan komt">
 *     <p>ING, saldo van 19 augustus. Rente per 1 augustus, bron geld.nl.</p>
 *   </ToonMeer>
 *
 *   // 2. "info": een klein ⓘ naast een kop.
 *   <ToonMeer
 *     variant="info"
 *     heading={<h3 className="module-title">Categorieën</h3>}
 *     summary="Hoe deze indeling tot stand komt"
 *   >
 *     <p>Tien kleinere categorieën zijn samengevat als "overig".</p>
 *   </ToonMeer>
 *
 * ── DE MARKUP DIE JE KRIJGT (stabiel; hierop mag je testen) ───────────────
 *
 *   <details class="toonmeer toonmeer-regel">      ← dicht: GEEN open-attribuut
 *     <summary class="toonmeer-summary">
 *       <span class="toonmeer-label">Waar dit cijfer vandaan komt</span>
 *       <span class="toonmeer-mark" aria-hidden="true"></span>
 *     </summary>
 *     <div class="toonmeer-panel">…children…</div>
 *   </details>
 *
 * Bij variant="info" heet de wortelklasse `toonmeer toonmeer-info`, staat de
 * `heading` als eerste in de <summary>, is `.toonmeer-label` alleen voor de
 * schermlezer (de ⓘ is de zichtbare knop) en herhaalt `title` de belofte voor
 * wie met de muis blijft hangen. De klassenamen staan ook in TOONMEER_CLASS
 * hieronder, zodat een test ze importeert in plaats van ze over te tikken.
 *
 * ── DRIE DINGEN DIE JE MOET WETEN VOOR JE HIERTEGENAAN TEST ───────────────
 *
 * 1. DICHT BETEKENT NIET WEG. Bij <details> blijven de kinderen in de DOM; de
 *    browser verbergt ze (en houdt ze uit de schermlezer). Test dus op
 *    `details.open === false`, NIET op `expect(html).not.toContain("…")` —
 *    die assertie faalt terwijl het onderdeel precies goed werkt.
 * 2. JSDOM OPENT WEL OP KLIK, NIET OP ENTER. Een klik op de <summary> zet
 *    `open` netjes om; de toetsactivering van <summary> implementeert jsdom
 *    niet. Een keydown-test hier bewijst dus niets over een echte browser —
 *    de toetsenbedieningsclaim leunt op de elementkeuze, niet op een
 *    nagespeelde toetsaanslag. Zie ToonMeer.test.tsx.
 * 3. HET TOGGLE-EVENT KOMT LATER. `onToggle` vuurt in een volgende task (dat
 *    is de spec, niet een jsdom-eigenaardigheid): in een test moet je er één
 *    macrotask op wachten.
 *
 * ── WAAROM <details> EN GEEN <button aria-expanded> ───────────────────────
 *
 * Beide waren verdedigbaar; dit gaf de doorslag.
 *  + De browser levert Tab-focus, Enter/Space én het uitspreken van de staat.
 *    Bij een knop moeten aria-expanded, een verzonnen aria-controls-id en de
 *    React-state met de hand kloppen — vier lanes die dat elk apart naschrijven
 *    is vier kansen om het half te doen.
 *  + De staat zit niet in React, dus `renderToStaticMarkup` — waarmee een groot
 *    deel van de tests in deze repo rendert, want er is geen DOM-testlib —
 *    kan het onderdeel gewoon in beide standen renderen. Een knop met useState
 *    krijg je daar nooit open.
 *  + Geen useState is ook geen plek waar iemand later "even" een fade aan hangt
 *    (regel 12: geen animaties, transitions of keyframes).
 * Wat het kost, eerlijk:
 *  − De opmaak van de <summary> moet je zelf terugpakken: het driehoekje
 *    (list-style + ::-webkit-details-marker) en de focusring, want base.css
 *    geeft die alleen aan `button:focus-visible`. Beide staan in modules.css;
 *    zonder die twee regels is dit onderdeel zichtbaar kapot en met het
 *    toetsenbord onvindbaar.
 *  − Je kunt een <details> geen `display: contents` of `display: inline` geven
 *    om het paneel uit een flex-rij te laten ontsnappen: dan verliest het zijn
 *    open/dicht-gedrag en staat alles altijd open. Vandaar `heading` — de kop
 *    gaat de <summary> ín (HTML staat kopinhoud daar toe), waarmee het ⓘ naast
 *    de kop staat en het paneel eronder op volle breedte, zonder positietruc.
 */

/** Twee verschijningsvormen; de waarde is ook het achtervoegsel van de klasse. */
export type ToonMeerVariant = "regel" | "info";

/** De klassenamen waar de opmaak (styles/modules.css) en de tests van de andere
 *  lanes op staan. Importeer deze in plaats van de strings over te tikken: een
 *  hernoeming die hier langskomt, komt dan ook langs in jouw test. */
export const TOONMEER_CLASS = {
  root: "toonmeer",
  summary: "toonmeer-summary",
  label: "toonmeer-label",
  mark: "toonmeer-mark",
  panel: "toonmeer-panel",
} as const;

export type ToonMeerProps = {
  /** VERPLICHT, en het moet een belofte zijn: "waar dit cijfer vandaan komt",
   *  niet "meer informatie". Een label dat niets belooft is een label waar
   *  niemand op klikt, en dan is de onderbouwing niet opgevouwen maar zoek. */
  summary: string;
  /** Standaard "regel": de volle regel onder een blok. "info" is het kleine ⓘ. */
  variant?: ToonMeerVariant;
  /** Alleen bij variant="info": de kop waar het ⓘ naast hoort te staan. Hij
   *  gaat de <summary> in, zodat de hele kopregel het klikvlak is en het paneel
   *  eronder de volle breedte krijgt. Laat hem weg voor een los ⓘ. */
  heading?: ReactNode;
  /** Eigen klasse op de <details>, achteraan — voor plaatsing, niet voor de vorm. */
  className?: string;
  /** Gemeld met de NIEUWE stand, één task na de klik. Bedoeld voor inhoud die
   *  je pas wilt opbouwen als er iemand naar kijkt; de kinderen zelf renderen
   *  altijd (zie punt 1 hierboven). */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
};

export default function ToonMeer({
  summary,
  variant = "regel",
  heading,
  className,
  onToggle,
  children,
}: ToonMeerProps) {
  const { root, summary: summaryClass, label, mark, panel } = TOONMEER_CLASS;
  const info = variant === "info";
  const classes = [root, `${root}-${variant}`, className].filter(Boolean).join(" ");

  return (
    <details
      className={classes}
      /* Geen `open` en geen defaultOpen-prop: standaard dicht is de hele
       * bedoeling van dit onderdeel, dus er is geen knop om dat af te zetten. */
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary
        className={summaryClass}
        /* Alleen bij het ⓘ, want daar is de belofte niet te lezen. Een tooltip
         * die de zichtbare regel herhaalt is ruis. */
        title={info ? summary : undefined}
      >
        {/* Alleen bij het ⓘ. Bij een volle regel onder een blok hoort de kop
          * erboven te staan, niet in de klikregel — een `heading` die daar per
          * ongeluk meekomt valt weg in plaats van de regel te verbouwen. */}
        {info && heading}
        {/* De ⓘ draagt zijn teken in de JSX omdat het niet van de stand afhangt;
          * de +/− van de volle regel komt uit CSS, want alleen het stylesheet
          * weet of de <details> openstaat — React weet dat niet en dat is juist
          * de winst. Beide zijn aria-hidden: de <summary> vertelt de staat al. */}
        {info ? <span className={mark} aria-hidden="true">i</span> : null}
        <span className={label}>{summary}</span>
        {info ? null : <span className={mark} aria-hidden="true" />}
      </summary>
      <div className={panel}>{children}</div>
    </details>
  );
}
