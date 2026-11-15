/* OpenFIGI exchange codes for the MICs DeGiro prints.
 *
 * DeGiro's `Uitvoeringsplaats` is an execution-venue MIC, while OpenFIGI rows
 * carry their own `exchCode`. This table is the only translation between them;
 * a MIC that is not listed is no hint, never a guess.
 *
 * Only explicit pairs belong here. OpenFIGI also returns composite codes such
 * as `US` for "any US venue"; a hint that maps to one of those would match
 * every listing in that market, so no MIC maps to them. */
const MIC_TO_OPENFIGI: Readonly<Record<string, string>> = {
  XAMS: "NA",
  XLON: "LN",
  XETR: "GY",
  XNAS: "UW",
  XNYS: "UN",
  XMIL: "IM",
  XPAR: "FP",
  XMAD: "SM",
  XSWX: "SW",
};

const OPENFIGI_TO_MIC: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MIC_TO_OPENFIGI).map(([mic, code]): [string, string] => [code, mic]),
);

/** The OpenFIGI exchange code for a venue MIC, or null when the MIC is unknown.
 *  Case and surrounding whitespace do not matter. */
export function openFigiExchangeForMic(mic: string | undefined): string | null {
  if (mic === undefined) return null;
  const normalized = mic.trim().toUpperCase();
  if (!Object.hasOwn(MIC_TO_OPENFIGI, normalized)) return null;
  return MIC_TO_OPENFIGI[normalized];
}

/** The venue MIC for an OpenFIGI exchange code, or null when it is not one of
 *  the MICs this table covers. Reverse lookups use the same explicit pairs. */
export function micForOpenFigiExchange(code: string | undefined): string | null {
  if (code === undefined) return null;
  const normalized = code.trim().toUpperCase();
  if (!Object.hasOwn(OPENFIGI_TO_MIC, normalized)) return null;
  return OPENFIGI_TO_MIC[normalized];
}
