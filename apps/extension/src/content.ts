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

    /* Het puntenblok staat BOVEN de kaarten, in allebei de toestanden. Dat is
     * geen opmaakvoorkeur: dit is wat hij al heeft liggen, en het is het enige
     * deel dat ook nog iets zegt als het bedrag op deze pagina niet te lezen
     * was. */
    function toonPunten(punten: PaneelPunten): void {
      if (punten.leeg) {
        paneel.appendChild(el("div", "groep", PUNTENKOP));
        paneel.appendChild(el("div", "uitleg", punten.leeg));
        return;
      }
      if (punten.regels.length === 0) return;
      paneel.appendChild(el("div", "groep", PUNTENKOP));
      for (const r of punten.regels) {
        const rij = el("div", "rij");
        rij.appendChild(el("div", "titel", r.titel));
        rij.appendChild(el("div", "regel", r.regel));
        if (r.bron) rij.appendChild(el("div", "bron", r.bron));
        paneel.appendChild(rij);
      }
      if (punten.voetnoot) paneel.appendChild(el("div", "bron", punten.voetnoot));
    }

    if (antwoord.soort === "geen-bedrag") {
      paneel.appendChild(el("div", "kop", antwoord.kop));
      paneel.appendChild(el("div", "uitleg", antwoord.uitleg));
      toonPunten(antwoord.punten);
      paneel.appendChild(el("div", "voet", antwoord.voet));
    } else {
      if (antwoord.bedrag) paneel.appendChild(el("div", "bedrag", antwoord.bedrag));
      if (antwoord.bedragNoot) paneel.appendChild(el("div", "noot", antwoord.bedragNoot));
      toonPunten(antwoord.punten);
      paneel.appendChild(el("div", "kop", antwoord.kop));

      let vorigeGroep: PaneelGroep | null = null;
      for (const r of antwoord.regels) {
        if (r.groep !== vorigeGroep) {
          paneel.appendChild(el("div", "groep", GROEPKOP[r.groep]));
          vorigeGroep = r.groep;
        }
        const rij = el("div", "rij");
        rij.appendChild(el("div", "titel", r.titel));
        rij.appendChild(el("div", "regel", r.regel));
        if (r.bron) rij.appendChild(el("div", "bron", r.bron));
        paneel.appendChild(rij);
      }

      paneel.appendChild(el("div", "voet", antwoord.voet));
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
