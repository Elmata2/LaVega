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
 *  doet er verder niets mee dan groeperen.
 *
 *  "geen-euro-uitkomst" IS ER LATER BIJ GEKOMEN EN DAT WAS EEN CORRECTIE. De
 *  kaarten waarvan de opbrengst niet in euro's is uit te drukken zaten in
 *  dezelfde groep als de kaarten waarvan we de PRIJS niet kennen, onder de kop
 *  "Kaartkosten onbekend". Bij Crypto.com Obsidian stond in dezelfde record
 *  letterlijk "€450,000 12-month CRO staking": de kaartkosten waren daar niet
 *  onbekend, ze stonden er. De rij zei dat inmiddels goed, de kop erboven niet —
 *  en een groepskop is de sterkste uitspraak in dat blok. Twee verschillende
 *  onbekenden horen dus niet onder één kop. */
declare type PaneelGroep =
  | "mijn"
  | "openen"
  | "achteruit"
  | "onbekende-kosten"
  | "geen-euro-uitkomst"
  | "onbekend";

/** Eén puntenprogramma in het paneel. Zelfde vorm als een kaartregel — titel,
 *  zin, bron — omdat het content script er hetzelfde mee doet: neerzetten. */
declare type PaneelPuntRegel = {
  titel: string;
  regel: string;
  bron: string;
};

/** Het puntenblok. Staat BOVEN de kaarten, want dit is wat hij al heeft liggen
 *  en dat is het antwoord op de vraag waarom deze extensie er is.
 *
 *  `regels` mag leeg zijn; dan draagt `leeg` de ene zin die er dan hoort te
 *  staan (waar hij zijn saldi invoert) en verschijnt er geen kop over punten
 *  boven een lege lijst. */
declare type PaneelPunten = {
  regels: PaneelPuntRegel[];
  /** De zin onder het blok: dat punten niet verloren gaan door hier anders te
   *  betalen, en bij vreemde valuta dat inwisselen hier juist geld kost. */
  voetnoot: string;
  /** Gevuld als er geen enkel saldo is ingevoerd; anders "". */
  leeg: string;
};

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
      punten: PaneelPunten;
      /** Wat er over zijn aanbiedingen gezegd mag worden, ÉÉN BLOK PER BRON.
       *
       *  Een lijst en niet één blok, omdat er twee bronnen zijn (Amex en de ING
       *  Winkel) met elk een eigen schakelaar. Ze samenvoegen tot één blok zou
       *  betekenen dat een regel uit de ING Winkel onder de kop van Amex kan
       *  staan — en dat is precies de verwarring die hier niet mag ontstaan: het
       *  ene is een korting bij deze winkel, het andere een aankoop bij ING.
       *
       *  Bronnen die zwijgen (schakelaar uit) staan er niet in; de lijst is dan
       *  leeg en er verschijnt niets. */
      aanbod: PaneelAanbod[];
      regels: PaneelRegel[];
      /** De regel onderaan: peildatum van de gegevens en wat er níét gebeurt. */
      voet: string;
    }
  /** Er staat wel een pagina maar er is geen bedrag met zekerheid te lezen. Dan
   *  wordt er niet gegokt en wijst het paneel naar de plek waar het handmatige
   *  veld wél staat.
   *
   *  HET PUNTENBLOK GAAT HIER WÉL MEE, en dat is de belangrijkste eigenschap van
   *  deze toestand. Wat hij aan punten heeft liggen hangt niet van het bedrag op
   *  deze pagina af. Voorheen zweeg het paneel hier volledig — juist op de
   *  IKEA-pagina's met een actieprijs, waar het bedrag een bereik is en dus niet
   *  te lezen. Nu staat er nog steeds iets waars en bruikbaars. */
  | {
      soort: "geen-bedrag";
      kop: string;
      uitleg: string;
      punten: PaneelPunten;
      aanbod: PaneelAanbod[];
      voet: string;
    }
  /** Niets tonen. `reden` is voor de console van de ontwikkelaar, niet voor het
   *  scherm — een paneel dat verschijnt om te melden dat het er niet hoort te
   *  zijn, is erger dan geen paneel. */
  | { soort: "zwijg"; reden: string };

/* ─────────────────────── de Amex-aanbiedingen ─────────────────────────────── */

/** Van het script op zijn aanbiedingenpagina naar de service worker. Eén soort,
 *  zonder inhoud — net als PaneelVerzoek, en om dezelfde reden: de worker weet
 *  uit `sender.url` waar het bericht vandaan komt, en dat is het enige veld dat
 *  niet door de pagina te zetten is. */
declare type AanbodVerzoek = { soort: "aanbod-vragen" };

/** Terug naar die pagina: één zin over wat er gelezen is, en niets anders.
 *
 *  GEEN AANBIEDINGEN IN DIT ANTWOORD. Het script op de Amex-pagina hoeft ze niet
 *  te kennen — het zet één regel neer dat er gelezen is en hoeveel. Zo kan de
 *  bevestigingsstrook niet per ongeluk iets tonen wat er niet in hoort, en is er
 *  op die pagina geen tweede plek waar zijn gegevens langskomen.
 *
 *  `gelukt` bepaalt alleen de toon van de regel, niet of hij verschijnt: een
 *  mislukte lezing hoort hij juist te zien, met de oorzaak. Stil falen op de
 *  pagina die hij net voor ons heeft opengedaan, is de slechtste uitkomst. */
declare type AanbodAntwoord =
  | {
      soort: "melding";
      /** Kwam er een aanbieding uit? Bepaalt de toon van de regel, niet of hij
       *  verschijnt. */
      gelukt: boolean;
      /** Mag het script het over een paar seconden nog eens vragen? De pagina
       *  bouwt haar aanbiedingen NA het laden op, dus "nog niets gevonden" kan
       *  gewoon "nog niet klaar" betekenen. Bij een inlogformulier is het
       *  antwoord definitief en staat hier false: dan is doorvragen zinloos. */
      opnieuw: boolean;
      regel: string;
      noot: string;
    }
  /** Niets tonen: de toestemming staat uit of de afzender klopt niet. `reden`
   *  is voor de console van de ontwikkelaar en niet voor het scherm. */
  | { soort: "zwijg"; reden: string };

/** Het aanbiedingenblok in het paneel en in het werkbalkvenster.
 *
 *  `kop` LEEG BETEKENT: HELEMAAL NIETS TONEN. Dat is de toestand waarin hij de
 *  schakelaar niet heeft aangezet. Een uitnodiging om een leestoestemming aan te
 *  zetten, neergezet op het moment dat hij aan het afrekenen is, is reclame op
 *  het slechtste moment; die vraag hoort in het optiescherm. */
declare type PaneelAanbod = {
  kop: string;
  regels: PaneelPuntRegel[];
  /** De ene zin als er geen regels zijn: de echte oorzaak, niet een leeg blok.
   *  "" als er wél regels zijn. */
  toestand: string;
};
