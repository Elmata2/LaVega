/* De strook op zijn eigen Amex-aanbiedingenpagina.
 *
 * DIT BESTAND HEEFT GEEN ENKELE IMPORT, om precies dezelfde reden als
 * src/content.ts: een content script in Manifest V3 wordt als KLASSIEK script
 * geladen, en één `import` maakt het stil onwerkzaam met de fout alleen in de
 * console van de Amex-pagina. De gedeelde typen staan als ambient globals in
 * src/messages.d.ts.
 *
 * ── WAAROM ER ÜBERHAUPT IETS OP DIE PAGINA VERSCHIJNT ──────────────────────
 *
 * Het zou minder opdringerig zijn om hier niets te tonen en de uitkomst alleen
 * in het optiescherm te zetten. Dat is precies waarom het hier wél staat: dit is
 * het moment waarop de extensie zijn ingelogde accountpagina leest. Stil lezen
 * en de uitkomst ergens anders neerzetten, betekent dat hij niet kan merken
 * wanneer het gebeurt — en bij een leestoestemming op een account is "je kunt
 * zien wanneer hij gebruikt wordt" geen extraatje maar de helft van de
 * toestemming.
 *
 * De strook zegt daarom altijd hetzelfde soort ding: wat er gelezen is, en wat
 * er niet gelezen is. Ook als er niets uitkwam — juist dan, want dan hoort hij
 * de echte oorzaak te horen in plaats van te denken dat het werkt.
 *
 * ── WAAROM ER DRIE KEER GEVRAAGD WORDT ────────────────────────────────────
 *
 * De aanbiedingen staan niet in de HTML die de server stuurt. Op 22 augustus
 * 2026 gemeten: het adres geeft 676.522 bytes met alleen de schil erin, en de
 * bundels `axp-offers-container` en `axp-offers-hub` bouwen de lijst daarna in
 * de browser op. `document_idle` is dus te vroeg. Eén poging zou bij bijna elk
 * bezoek "de pagina is veranderd" opleveren, en dat is een onware oorzaak.
 *
 * Dus wordt er opnieuw gevraagd, maar alleen als de service worker zegt dat het
 * zin heeft (`opnieuw`). Bij een inlogformulier is het antwoord definitief en
 * wordt er niet doorgevraagd: nog vier keer een uitgelogde pagina lezen levert
 * vier keer hetzelfde op.
 *
 * GEEN ANIMATIE, GEEN TRANSITION. De strook staat er of hij staat er niet. */

(() => {
  const GASTHEER_ID = "lavega-amex";

  if (document.getElementById(GASTHEER_ID)) return;

  /* Wachttijden in milliseconden. Vier pogingen over ruim tien seconden: lang
   * genoeg voor een trage verbinding, kort genoeg dat de strook er nog staat
   * als hij nog op deze pagina is. Meer pogingen zouden de pagina blijven
   * aftasten terwijl hij allang verder is. */
  const POGINGEN = [0, 1500, 4000, 9000];

  const STIJL = `
    :host { all: initial; }
    .strook {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483000;
      width: 340px;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      padding: 12px 14px 11px;
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
    .regel { margin-top: 8px; }
    .noot { margin-top: 6px; color: #6f6a5f; font-size: 11.5px; }
  `;

  function toon(regel: string, noot: string): void {
    if (document.getElementById(GASTHEER_ID)) return;

    const gastheer = document.createElement("div");
    gastheer.id = GASTHEER_ID;
    /* Gesloten schaduw-DOM, net als het paneel: de pagina kan er niet in kijken
     * en er niets aan stukmaken. Dat de pagina hier van Amex zelf is, maakt dat
     * niet minder waar — er draait op zo'n pagina van alles mee. */
    const schaduw = gastheer.attachShadow({ mode: "closed" });

    const stijl = document.createElement("style");
    stijl.textContent = STIJL;
    schaduw.appendChild(stijl);

    const strook = document.createElement("div");
    strook.className = "strook";
    strook.setAttribute("role", "status");
    strook.setAttribute("aria-label", "LaVega heeft je aanbiedingen gelezen");

    const balk = document.createElement("div");
    balk.className = "balk";
    const merk = document.createElement("span");
    merk.className = "merk";
    /* textContent en nooit innerHTML: in `regel` staat een winkelnaam die van
     * deze pagina komt, en die is niet van ons. */
    merk.textContent = "LaVega · aanbiedingen";
    balk.appendChild(merk);
    const sluit = document.createElement("button");
    sluit.type = "button";
    sluit.className = "sluit";
    sluit.textContent = "×";
    sluit.setAttribute("aria-label", "Sluiten");
    sluit.addEventListener("click", () => gastheer.remove());
    balk.appendChild(sluit);
    strook.appendChild(balk);

    const r = document.createElement("div");
    r.className = "regel";
    r.textContent = regel;
    strook.appendChild(r);

    const n = document.createElement("div");
    n.className = "noot";
    n.textContent = noot;
    strook.appendChild(n);

    /* Escape sluit, maar alleen met de aandacht in de strook — een globale
     * Escape-vanger zou de dialogen van Amex zelf in de weg zitten. */
    strook.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") gastheer.remove();
    });

    schaduw.appendChild(strook);
    document.documentElement.appendChild(gastheer);
  }

  function vraag(nummer: number): void {
    const verzoek: AanbodVerzoek = { soort: "aanbod-vragen" };
    chrome.runtime
      .sendMessage<AanbodAntwoord | undefined>(verzoek)
      .then((antwoord) => {
        /* Geen antwoord is geen leeg antwoord. Sliep de service worker, dan
         * resolvet sendMessage met undefined en weten we niets — dan verschijnt
         * er niets, want een strook die zegt dat er niets gelezen is terwijl de
         * worker lag te slapen, is een bewering die op niets rust. */
        if (!antwoord) return;
        if (antwoord.soort === "zwijg") return;

        const laatste = nummer >= POGINGEN.length - 1;
        if (antwoord.gelukt || !antwoord.opnieuw || laatste) {
          toon(antwoord.regel, antwoord.noot);
          return;
        }
        setTimeout(() => vraag(nummer + 1), POGINGEN[nummer + 1]);
      })
      .catch(() => {
        /* Afgebroken kanaal. Stil laten: er is op deze pagina geen plek waar een
         * technische oorzaak thuishoort. */
      });
  }

  setTimeout(() => vraag(0), POGINGEN[0]);
})();
