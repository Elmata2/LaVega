/* De chrome.*-API's die deze extensie aanroept. Met de hand getypeerd, want
 * @types/chrome installeren zou een wijziging in de lockfile van de hele repo
 * betekenen terwijl er andere lanes in draaien.
 *
 * Dat is minder comfort en meer controle, en dat tweede is hier het punt: deze
 * lijst is TEGELIJK de documentatie van wat de extensie kan. Wat er niet in
 * staat, kan niet worden aangeroepen zonder dat iemand dit bestand opent en er
 * een regel bij zet — en dat is precies het moment waarop de vraag "waarom heeft
 * een kassa-extensie chrome.cookies nodig?" gesteld hoort te worden.
 *
 * WAT ER BEWUST NIET IN STAAT, hoewel het bestaat en zou werken:
 *   chrome.tabs      — de extensie hoeft niet te weten welke tabbladen je open
 *                      hebt. De service worker krijgt het tab-id van de afzender
 *                      van het bericht en heeft verder niets nodig.
 *   chrome.cookies   — nooit.
 *   chrome.webRequest, chrome.history, chrome.bookmarks, chrome.downloads — nooit.
 *   fetch/XHR        — staat niet in dit bestand omdat het in de DOM-lib zit.
 *                      Het manifest zet er `connect-src 'none'` overheen, MAAR
 *                      alleen voor `extension_pages`: de popup, het optiescherm
 *                      en de service worker. Een CONTENT SCRIPT valt daar niet
 *                      onder — dat draait binnen de CSP van de winkelpagina, en
 *                      die is van de winkel. Deze regel stond er eerst zonder
 *                      dat voorbehoud en stelde de dekking dus te breed voor.
 *                      Wat het content script tegenhoudt is iets anders: er
 *                      staat geen netwerkaanroep in src/content.ts, en
 *                      copy-static.mjs scant dat bestand bij elke build op
 *                      fetch, XHR, WebSocket, sendBeacon, EventSource,
 *                      importScripts, new Image() en op elke URL in
 *                      resourcepositie. Een poort in de build, geen belofte van
 *                      het manifest.
 *
 * De vijf namespaces die er wél in staan zijn runtime, storage, permissions,
 * scripting en dom, en elk daarvan alleen in de vorm die we gebruiken: de
 * Promise-vorm. De callback-varianten staan er niet in, zodat een halve
 * migratie tussen die twee stijlen niet stilletjes kan ontstaan.
 *
 * `dom` IS OP 24 AUGUSTUS 2026 TOEGEVOEGD en is de enige regel in dit bestand
 * met een ongeverifieerde belofte eronder — zie de uitleg bij de namespace
 * zelf. Dat die toevoeging opvalt, is precies waarvoor dit bestand bestaat. */

declare namespace chrome {
  namespace runtime {
    function sendMessage<T = unknown>(message: unknown): Promise<T>;

    function openOptionsPage(): Promise<void>;

    type MessageSender = {
      tab?: { id?: number; url?: string };
      /** De herkomst van de afzender. De service worker controleert deze tegen
       *  de sitelijst: een bericht kan van elke pagina komen waar ons content
       *  script draait, en "waar het vandaan komt" is de enige manier om te
       *  weten of het van een pagina komt waar de gebruiker ja tegen zei. */
      origin?: string;
      url?: string;
    };

    const onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined | void,
      ): void;
    };

    const onInstalled: { addListener(cb: () => void): void };
    const onStartup: { addListener(cb: () => void): void };
  }

  namespace storage {
    type Items = Record<string, unknown>;
    const local: {
      get(keys: string[] | string | null): Promise<Items>;
      set(items: Items): Promise<void>;
      /** Sleutels ECHT weghalen. Staat hier omdat het intrekken van de
       *  Amex-toestemming het opgeslagene moet WISSEN en niet leegmaken: een
       *  lege lijst is nog steeds een sleutel, en in chrome://extensions is dat
       *  het verschil tussen "deze extensie weet niets van mij" en "deze
       *  extensie heeft een leeg vakje met mijn naam erop". Zie `wisAmex` in
       *  store.ts. */
      remove(keys: string[] | string): Promise<void>;
    };
    const onChanged: {
      addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
    };
  }

  namespace permissions {
    type Descriptor = { origins?: string[]; permissions?: string[] };
    function request(p: Descriptor): Promise<boolean>;
    function remove(p: Descriptor): Promise<boolean>;
    function contains(p: Descriptor): Promise<boolean>;
    const onRemoved: { addListener(cb: (p: Descriptor) => void): void };
    const onAdded: { addListener(cb: (p: Descriptor) => void): void };
  }

  namespace scripting {
    type InjectionResult<T> = { result?: T; frameId: number };

    /** De `func`-vorm, niet de `files`-vorm. Chrome verstuurt de functie als
     *  TEKST naar de pagina, dus ze mag niets van buiten haar eigen body
     *  gebruiken — zie de kop van collectEvidence in read.ts, die daar
     *  expliciet op is gebouwd. `args` moet JSON-serialiseerbaar zijn. */
    function executeScript<A extends unknown[], R>(injection: {
      target: { tabId: number; allFrames?: boolean };
      func: (...args: A) => R;
      args?: A;
      world?: "ISOLATED" | "MAIN";
    }): Promise<InjectionResult<Awaited<R>>[]>;

    type RegisteredContentScript = {
      id: string;
      matches?: string[];
      js?: string[];
      runAt?: "document_start" | "document_end" | "document_idle";
      persistAcrossSessions?: boolean;
      world?: "ISOLATED" | "MAIN";
    };

    function registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
    function unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
    function getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScript[]>;
  }

  /** ÉÉN FUNCTIE, EN ZE STAAT HIER MET HAAR VOORBEHOUD ERBIJ.
   *
   *  `openOrClosedShadowRoot(el)` geeft de schaduwwortel van een element ook als
   *  die met `mode: "closed"` is aangehangen. Alleen beschikbaar in een content
   *  script (de ISOLATED wereld), zonder enige extra toestemming, sinds
   *  Chrome 88 — ruim onder de `minimum_chrome_version` 102 van dit manifest.
   *
   *  WAAROM DIT MAG. Hij geeft geen toegang tot iets nieuws: dezelfde pagina,
   *  dezelfde wereld, dezelfde toestemming. Wat er van die pagina AF komt wordt
   *  niet hier bepaald maar door de patronen in ing.ts, en die zijn met deze
   *  wijziging niet ruimer maar STRENGER geworden (drie saldo-zeven in plaats
   *  van één). Wat hij verandert is bereik binnen die ene pagina.
   *
   *  WAAROM HIJ NIET RECHTSTREEKS WORDT AANGEROEPEN. Hij is NIET geverifieerd in
   *  Brave, de browser van de eigenaar, en dat is vanaf deze machine ook niet te
   *  controleren. `collectIngWinkel` leest hem daarom van `globalThis` en
   *  controleert eerst of het een functie is: die functie draait ook in jsdom
   *  (geen `chrome`) en wordt door Chrome uit haar eigen tekst opgebouwd, dus een
   *  kale naam zou daar een ReferenceError zijn die alleen in zijn console te
   *  zien is. Ontbreekt hij, dan blijft een gesloten wortel onbereikbaar en zegt
   *  de strook dát — de uitkomst "afgeschermd" in aanbod-kern.ts. */
  namespace dom {
    function openOrClosedShadowRoot(element: Element): ShadowRoot | null;
  }
}
