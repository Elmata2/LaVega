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
 * De vier namespaces die er wél in staan zijn runtime, storage, permissions en
 * scripting, en elk daarvan alleen in de vorm die we gebruiken: de
 * Promise-vorm. De callback-varianten staan er niet in, zodat een halve
 * migratie tussen die twee stijlen niet stilletjes kan ontstaan. */

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
}
