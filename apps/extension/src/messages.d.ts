/* Het berichtcontract tussen het content script en de service worker.
 *
 * WAAROM DIT EEN .d.ts IS EN GEEN GEWONE MODULE, want dat is een rare keuze die
 * uitleg verdient. Een content script in Manifest V3 is een KLASSIEK script: er
 * is geen `import` en er is geen module-scope. Zodra src/content.ts ook maar één
 * `import` bevat, zet tsc er een `import`-regel in de uitvoer en weigert Chrome
 * het bestand met "Cannot use import statement outside a module" — een fout die
 * je alleen ziet als je de console van de PAGINA openslaat, niet die van de
 * extensie. Dat kost een avond.
 *
 * Een ambient .d.ts is de uitweg: de typen staan hier globaal, content.ts kan ze
 * gebruiken zonder te importeren, en er komt geen regel javascript uit dit
 * bestand. De service worker (die wél een module is) gebruikt exact dezelfde
 * typen, dus de twee kanten kunnen niet uit elkaar lopen zonder dat tsc het
 * merkt. Dat is de hele reden dat het contract niet aan één kant is verzonnen.
 *
 * ── WAT ER OVER DE LIJN GAAT, en dat is bewust weinig ───────────────────────
 *
 * Van de pagina naar de worker: NIETS behalve "ik ben er". Geen URL, geen
 * bedrag, geen artikel. De worker weet uit `sender.origin` waar het bericht
 * vandaan komt en dat is genoeg.
 *
 * Van de worker naar de pagina: ALLEEN AFGEMAAKTE NEDERLANDSE ZINNEN. Geen
 * centen, geen kaart-id's, geen catalogusrijen. Het content script kan dus niet
 * rekenen en hoeft dat ook niet: het plakt tekst in een schaduw-DOM. Als er ooit
 * iets misgaat in de weergave, kan het niet een verkeerd BEDRAG zijn — hooguit
 * een verkeerde zin, en zinnen zijn getest in lines.test.ts. */

/** Van content script naar service worker. Eén soort, zonder inhoud. */
declare type PaneelVerzoek = { soort: "paneel-vragen" };

/** Waar een regel bij hoort. Bepaalt alleen de kop erboven; het content script
 *  doet er verder niets mee dan groeperen. */
declare type PaneelGroep = "mijn" | "openen" | "achteruit" | "onbekende-kosten" | "onbekend";

declare type PaneelRegel = {
  /** De productnaam. */
  titel: string;
  /** De zin uit lines.ts. */
  regel: string;
  /** De bronregel met de datum, of "" als er niets te bronnen valt. */
  bron: string;
  groep: PaneelGroep;
};

declare type PaneelAntwoord =
  /** Er valt iets te zeggen. */
  | {
      soort: "toon";
      kop: string;
      /** Het gelezen bedrag als tekst, of null. */
      bedrag: string | null;
      /** Waar dat bedrag vandaan komt en wat het WEL en NIET is — een
       *  artikelprijs is geen ordertotaal. Null als er geen bedrag is. */
      bedragNoot: string | null;
      regels: PaneelRegel[];
      /** De regel onderaan: peildatum van de gegevens en wat er níét gebeurt. */
      voet: string;
    }
  /** Er staat wel een pagina maar er is geen bedrag met zekerheid te lezen. Dan
   *  wordt er niet gegokt en wijst het paneel naar de plek waar het handmatige
   *  veld wél staat. */
  | { soort: "geen-bedrag"; kop: string; uitleg: string; voet: string }
  /** Niets tonen. `reden` is voor de console van de ontwikkelaar, niet voor het
   *  scherm — een paneel dat verschijnt om te melden dat het er niet hoort te
   *  zijn, is erger dan geen paneel. */
  | { soort: "zwijg"; reden: string };
