import type { GateState } from "./vault-gate.js";

const SEEN_KEY = "lavega.onboardingSeen";

/* Of de eenmalige instelstap al is geweest.
 *
 * DE STAP ZELF WORDT NIET DOOR DEZE VLAG BESLIST. Hij komt alleen na een
 * VERSE kluis (`gate === "setup"`), zodat een bestaande gebruiker hem nooit
 * ziet — ook niet als deze sleutel ontbreekt omdat hij zijn browseropslag
 * heeft gewist. De vlag voorkomt alleen dat dezelfde nieuwe gebruiker hem
 * tweemaal krijgt binnen één sessie of na een herstart.
 *
 * Blijft buiten de kluis: het is een voorkeur van dit apparaat, net als de
 * taal en het land die de stap zelf zet, en niet iets wat in een back-up of
 * op een tweede apparaat hoort mee te reizen. */
export function onboardingSeen(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* quota/private mode — the step simply shows again, which is harmless */
  }
}

/** Of de kluis die zojuist openging NIEUW was, en de instelstap dus mag komen.
 *
 *  Alleen `setup`. `unlock` is iemand die de kluis al had, en `migrate` is per
 *  definitie iemand met data van vóór de kluis — die heeft een land en een taal
 *  die al kloppen.
 *
 *  `setup` betekent hier "deze BROWSER heeft nog geen kluis", niet "deze PERSOON
 *  is nieuw": wie een back-up terugzet op een nieuw apparaat komt er ook langs.
 *  Dat is met opzet goed — voorkeuren staan in localStorage en niet in de kluis,
 *  dus op een nieuw apparaat zijn ze er echt niet. Wat dan niet mag is ze
 *  overschrijven als ze er tóch zijn; daarom begint elk veld in `Onboarding`
 *  op de opgeslagen waarde.
 *
 *  Een losse functie en geen `gate === "setup"` in de JSX, omdat dit de hele
 *  regel is die "nieuwe kluis" van "bestaande kluis" scheidt. */
export function isFreshVault(gateWhenReady: GateState): boolean {
  return gateWhenReady === "setup";
}

/** Of de instelstap nu op het scherm hoort. De tweede helft van de regel, naast
 *  `isFreshVault`: één keer per verse kluis, en daarna nooit meer. */
export function showOnboarding(freshVault: boolean, seen: boolean): boolean {
  return freshVault && !seen;
}
