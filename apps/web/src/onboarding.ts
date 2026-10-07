const SEEN_KEY = "lavega.onboardingSeen";

/* Of de eenmalige instelstap al is geweest.
 *
 * DE STAP ZELF WORDT NIET DOOR DEZE VLAG BESLIST. Hij komt alleen na een
 * VERSE kluis (`open` gaf "created"), zodat een bestaande gebruiker hem nooit
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

/** Of de instelstap nu op het scherm hoort: één keer per verse kluis, en
 *  daarna nooit meer. `freshVault` is waar als `VaultStorage.open` de kluis
 *  van deze eigenaar in deze browser net aanmaakte ("created"), of als de
 *  eigenaar een oude wachtwoordkluis liet staan en leeg begon. */
export function showOnboarding(freshVault: boolean, seen: boolean): boolean {
  return freshVault && !seen;
}
