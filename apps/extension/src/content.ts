/* Het paneel op de winkelpagina.
 *
 * DIT BESTAND HEEFT GEEN ENKELE IMPORT EN DAT IS GEEN SLORDIGHEID. Een content
 * script in Manifest V3 wordt door Chrome als KLASSIEK script geladen. Eén
 * `import` erin en het bestand doet helemaal niets meer, met als enige spoor een
 * "Cannot use import statement outside a module" in de console van de PAGINA —
 * niet in die van de extensie, waar je zou kijken. Daarom staan de gedeelde
 * typen in src/messages.d.ts als ambient globals: die leveren geen javascript op
 * en dus ook geen import.
 *
 * Wat dit bestand daardoor NIET doet, en dat is de bedoeling: rekenen. Het
 * ontvangt afgemaakte Nederlandse zinnen en zet ze neer. Er is hier geen bedrag
 * en geen percentage, dus er is hier ook geen som die verkeerd kan gaan.
 *
 * ── SCHADUW-DOM, en waarom dat hier meer is dan netjes ─────────────────────
 *
 * Het paneel hangt in een `attachShadow({ mode: "closed" })`. Twee redenen:
 *
 *   1. De winkel kan er niet in kijken. Bij een open schaduw-root kan javascript
 *      van de pagina via `element.shadowRoot` de inhoud uitlezen — en die inhoud
 *      is een uitspraak over welke betaalkaarten iemand heeft. Dat is precies
 *      het soort ding dat een winkel niet hoort te weten.
 *   2. De winkel kan er niets aan stukmaken. Een `* { font-size: 0 }` of een
 *      agressieve reset uit de webshop haalt anders het paneel overhoop, en een
 *      onleesbaar paneel op een afrekenpagina is erger dan geen paneel.
 *
 * GEEN ANIMATIE, GEEN TRANSITION. Het paneel staat er of het staat er niet. */

(() => {
  const GASTHEER_ID = "lavega-kassa";

  /* Chrome kan een content script twee keer injecteren (bijvoorbeeld na
   * her-registratie terwijl het tabblad openstaat). Twee panelen over elkaar is
   * lelijk en dubbel werk. */
  if (document.getElementById(GASTHEER_ID)) return;

  const STIJL = `
    :host { all: initial; }
    .paneel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483000;
      width: 320px;
      max-width: calc(100vw - 32px);
      max-height: 60vh;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 14px 16px 12px;
      background: #ffffff;
      border: 1px solid #ddd8cd;
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(28, 28, 26, 0.14);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #1c1c1a;
      text-align: left;
    }
    .balk { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .merk { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #6f6a5f; }
    .sluit {
      appearance: none; border: 0; background: transparent; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 2px 4px; color: #6f6a5f; border-radius: 4px;
    }
    .sluit:hover { color: #1c1c1a; background: #f2efe8; }
    .sluit:focus-visible { outline: 2px solid #1c1c1a; outline-offset: 1px; }
    .bedrag { margin-top: 8px; font-size: 20px; font-weight: 600; }
    .noot { color: #6f6a5f; font-size: 11.5px; }
    .kop { margin-top: 8px; font-weight: 600; }
    .uitleg { margin-top: 6px; }
    .groep {
      margin-top: 12px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
      color: #6f6a5f; border-top: 1px solid #eae6dd; padding-top: 8px;
    }
    .rij { margin-top: 8px; }
    .titel { font-weight: 600; }
    .bron { color: #6f6a5f; font-size: 11.5px; }
    .voet { margin-top: 12px; padding-top: 8px; border-top: 1px solid #eae6dd;
            color: #6f6a5f; font-size: 11px; }
    /* HET ANTWOORD: de naam van de kaart die hier het meest oplevert, en verder
     * niets. De onderbouwing zit in een vouw eronder. */
    .antwoord { margin-top: 2px; font-size: 15px; font-weight: 600; }
    /* De vouwen. GEEN TRANSITION — zie de kop van dit bestand; <details> opent
     * en sluit, het schuift niet. */
    .vouw { margin-top: 10px; border-top: 1px solid #eae6dd; padding-top: 8px; }
    .vouw > summary {
      cursor: pointer; color: #6f6a5f; font-size: 11.5px;
      list-style: none; user-select: none;
    }
    .vouw > summary::-webkit-details-marker { display: none; }
    .vouw > summary::after { content: " ▾"; font-size: 10px; }
    .vouw[open] > summary::after { content: " ▴"; }
    .vouw > summary:focus-visible { outline: 2px solid #1c1c1a; outline-offset: 2px; border-radius: 3px; }
    /* Binnen een vouw begint het eerste kopje niet aan een tweede streep: de
     * vouw zelf is al de scheiding. */
    .vouw > .groep:first-of-type { border-top: 0; margin-top: 6px; padding-top: 0; }
    .vouw > .voet { border-top: 0; margin-top: 6px; padding-top: 0; }
  `;

  const GROEPKOP: Record<PaneelGroep, string> = {
    mijn: "Jouw kaarten",
    openen: "Zou je kunnen openen",
    /* Niet "niet doen" maar wat er feitelijk is uitgerekend. De reden staat in
     * de regel zelf, en die komt uit lines.ts waar hij getest is. */
    achteruit: "Kost na kaartkosten meer dan het oplevert",
    "onbekende-kosten": "Kaartkosten onbekend",
    /* Niet "kaartkosten onbekend": bij deze kaarten staan de kosten vaak wél in
     * de voorwaarde. Wat ontbreekt is een OPBRENGST in euro's, want de uitkering
     * is in een token of het cijfer is vervallen. Twee verschillende onbekenden
     * onder één kop was een onwaarheid in de sterkste regel van het blok. */
    "geen-euro-uitkomst": "Opbrengst niet in euro's",
    onbekend: "Hier kunnen we niets over zeggen",
  };

  const PUNTENKOP = "Punten die je hier hebt liggen";

  function el(tag: string, klasse: string, tekst?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = klasse;
    /* textContent en nooit innerHTML. De zinnen komen uit onze eigen code, maar
     * er staan productnamen uit de catalogus in en die zijn ooit van een
     * winkelpagina geschraapt. Eén regel html daarin en het paneel voert het uit
     * — in een schaduw-DOM die de pagina niet kan zien, wat het juist erger
     * maakt: niemand die het merkt. */
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  function toon(antwoord: PaneelAntwoord): void {
    if (antwoord.soort === "zwijg") return;
    if (document.getElementById(GASTHEER_ID)) return;

    const gastheer = document.createElement("div");
    gastheer.id = GASTHEER_ID;
    const schaduw = gastheer.attachShadow({ mode: "closed" });

    const stijl = document.createElement("style");
    stijl.textContent = STIJL;
    schaduw.appendChild(stijl);

    const paneel = el("aside", "paneel");
    paneel.setAttribute("role", "complementary");
    paneel.setAttribute("aria-label", "LaVega aan de kassa");

    const balk = el("div", "balk");
    balk.appendChild(el("span", "merk", "LaVega · aan de kassa"));
    const sluit = el("button", "sluit", "×") as HTMLButtonElement;
    sluit.type = "button";
    sluit.setAttribute("aria-label", "Paneel sluiten");
    sluit.addEventListener("click", () => gastheer.remove());
    balk.appendChild(sluit);
    paneel.appendChild(balk);

    /* ── DE INDELING, EN DE REGEL DIE HEM BEPAALT ──────────────────────────
     *
     * Wat je BESLISSING verandert staat open; wat het UITLEGT of GERUSTSTELT
     * vouwt weg. Voorheen stond alles even hard op het scherm: drie kaartregels
     * van elk drie- tot vierhonderd tekens, met de punten, de aanbiedingen en de
     * voetregel eronder — en dan is er geen antwoord meer, alleen tekst.
     *
     * Er wordt hier NIETS weggegooid. Elke zin die er stond staat er nog, één
     * klik verderop. Dat is het verschil tussen korter maken en minder zeggen.
     *
     * De volgorde BINNEN de vouwen blijft wat hij was: aanbiedingen boven
     * punten boven kaarten, om de redenen die hieronder bij elk blok staan. */
    function vouw(samenvatting: string): HTMLDetailsElement {
      const d = el("details", "vouw") as HTMLDetailsElement;
      const s = document.createElement("summary");
      s.textContent = samenvatting;
      d.appendChild(s);
      return d;
    }

    function rij(r: PaneelPuntRegel | PaneelRegel): HTMLElement {
      const e = el("div", "rij");
      e.appendChild(el("div", "titel", r.titel));
      e.appendChild(el("div", "regel", r.regel));
      if (r.bron) e.appendChild(el("div", "bron", r.bron));
      return e;
    }

    /* Een aanbieding die ECHT bij deze winkel of dit artikel hoort, verandert
     * wat je hier doet — die hoort dus bij het antwoord en niet in een vouw. De
     * toestandszin ("geen van je vouchers hoort bij deze winkel") legt alleen
     * uit waarom er niets staat, en dat is precies geruststelling: die vouwt.
     *
     * Een lege `kop` betekent nog steeds zwijgen: dan heeft hij de schakelaar
     * niet aangezet, en dan hoort er bij het afrekenen geen uitnodiging te
     * staan. */
    const aanbodMetRegels = antwoord.aanbod.filter((a) => a.kop && a.regels.length > 0);
    const aanbodZonderRegels = antwoord.aanbod.filter((a) => a.kop && a.regels.length === 0);

    function toonAanbodRegels(doel: HTMLElement): void {
      for (const blok of aanbodMetRegels) {
        doel.appendChild(el("div", "groep", blok.kop));
        for (const r of blok.regels) doel.appendChild(rij(r));
      }
    }

    /* Het puntenblok stond BOVEN de kaarten omdat het het enige deel is dat ook
     * nog iets zegt als het bedrag niet te lezen was. Dat blijft zo binnen de
     * vouw: het staat er vóór de kaarten in. Wat het niet meer doet is het
     * antwoord wegdrukken — een saldo dat er volgende week ook nog is, is geen
     * antwoord op de vraag "welke kaart nu". */
    function toonPunten(doel: HTMLElement, punten: PaneelPunten): void {
      if (punten.leeg) {
        doel.appendChild(el("div", "groep", PUNTENKOP));
        doel.appendChild(el("div", "uitleg", punten.leeg));
        return;
      }
      if (punten.regels.length === 0) return;
      doel.appendChild(el("div", "groep", PUNTENKOP));
      for (const r of punten.regels) doel.appendChild(rij(r));
      if (punten.voetnoot) doel.appendChild(el("div", "bron", punten.voetnoot));
    }

    /* De restvouw: alles wat geen antwoord is en ook geen onderbouwing van het
     * antwoord — de punten, de uitleg waarom er geen aanbieding staat, en de
     * voetregel met de peildatums en de leesgrens. */
    function toonRest(punten: PaneelPunten, voet: string): void {
      const rest = vouw("Punten en wat LaVega hier niet weet");
      toonPunten(rest, punten);
      for (const blok of aanbodZonderRegels) {
        rest.appendChild(el("div", "groep", blok.kop));
        rest.appendChild(el("div", "uitleg", blok.toestand));
      }
      rest.appendChild(el("div", "voet", voet));
      paneel.appendChild(rest);
    }

    if (antwoord.soort === "geen-bedrag") {
      /* HIER IS DE UITLEG HET ANTWOORD. "Het bedrag is hier niet te lezen, vul
       * het zelf in" is precies wat hij moet weten en doen; er is niets om
       * onder te bouwen. Hij blijft dus open staan. */
      paneel.appendChild(el("div", "kop", antwoord.kop));
      paneel.appendChild(el("div", "uitleg", antwoord.uitleg));
      toonAanbodRegels(paneel);
      toonRest(antwoord.punten, antwoord.voet);
    } else {
      if (antwoord.bedrag) paneel.appendChild(el("div", "bedrag", antwoord.bedrag));
      if (antwoord.bedragNoot) paneel.appendChild(el("div", "noot", antwoord.bedragNoot));

      /* HET ANTWOORD: de bovenste regel, en alleen zijn naam. `panelRows` heeft
       * ze al gerangschikt, dus de bovenste IS de aanbeveling.
       *
       * MET ZIJN GROEPKOP ERBOVEN, en dat is geen opmaak maar eerlijkheid. De
       * bovenste regel is niet altijd een kaart die hij HEEFT: het kan er een
       * zijn die hij zou kunnen openen, of zelfs een die na kaartkosten geld
       * kost. Alleen de naam groot neerzetten zou van "zou je kunnen openen"
       * een aanbeveling maken die er niet stond. De kop zegt welke van de zes
       * het is, en die tekst komt onveranderd uit GROEPKOP. */
      const [beste, ...overige] = antwoord.regels;
      if (beste) {
        paneel.appendChild(el("div", "groep", GROEPKOP[beste.groep]));
        paneel.appendChild(el("div", "antwoord", beste.titel));
      }

      toonAanbodRegels(paneel);

      /* De onderbouwing van precies díé kaart: de volledige zin met alle
       * voorwaarden erin, plus de bron met zijn controledatum. Ongewijzigd —
       * hij staat alleen niet meer standaard open. */
      if (beste) {
        const waarom = vouw("Waarom deze kaart");
        waarom.appendChild(el("div", "regel", beste.regel));
        if (beste.bron) waarom.appendChild(el("div", "bron", beste.bron));
        paneel.appendChild(waarom);
      }

      /* De rest van de kaarten, met hun groepkoppen zoals ze waren. Niets wordt
       * hier afgekapt: `panelRows` heeft de caps al toegepast en laat de
       * onbekenden er met opzet ongekapt in — dat mag deze vouw niet alsnog
       * stilzwijgend wegpoetsen. */
      if (overige.length > 0) {
        const meer = vouw(`Je andere kaarten (${overige.length})`);
        let vorigeGroep: PaneelGroep | null = beste ? beste.groep : null;
        for (const r of overige) {
          if (r.groep !== vorigeGroep) {
            meer.appendChild(el("div", "groep", GROEPKOP[r.groep]));
            vorigeGroep = r.groep;
          }
          meer.appendChild(rij(r));
        }
        paneel.appendChild(meer);
      }

      toonRest(antwoord.punten, antwoord.voet);
    }

    /* Escape sluit het paneel, maar alleen zolang de aandacht erin zit. Een
     * globale Escape-vanger op een winkelpagina zou de zoekbalk of de
     * maatkiezer van de winkel in de weg zitten. */
    paneel.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") gastheer.remove();
    });

    schaduw.appendChild(paneel);
    document.documentElement.appendChild(gastheer);
  }

  const verzoek: PaneelVerzoek = { soort: "paneel-vragen" };
  chrome.runtime
    .sendMessage<PaneelAntwoord | undefined>(verzoek)
    .then((antwoord) => {
      /* Geen antwoord is geen leeg antwoord. Als de service worker nog aan het
       * opstarten was of net is afgesloten, resolvet sendMessage met undefined.
       * Dan verschijnt er niets — wat juist is, want we WETEN dan niets. Een
       * paneel dat "geen kaarten gevonden" zegt omdat de worker lag te slapen,
       * is een bewering die op niets rust.
       *
       * De oorzaak zou in chrome.runtime.lastError staan en die lezen we
       * bewust niet: er is op een winkelpagina geen plek waar een technische
       * oorzaak thuishoort, en hem alleen naar de console schrijven zou een
       * API in chrome.d.ts zetten om iets te doen wat niemand leest. */
      if (!antwoord) return;
      toon(antwoord);
    })
    .catch(() => {
      /* Zelfde verhaal, andere vorm: bij een afgebroken kanaal rejectet de
       * Promise. Stil laten. */
    });
})();
