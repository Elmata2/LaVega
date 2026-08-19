/* THE CATALOGUE'S SAVINGS RATES, BUNDLED.
 *
 * The artifact ships inside the web bundle rather than being fetched, for the same
 * reason no logo is ever loaded at runtime: a request tells the server on the other
 * end something about the person making it, and a local-first app should not need
 * the network to tell a saver what their own bank pays.
 *
 * It is imported at BUILD time, so the figures are as fresh as the last deploy —
 * which is the honest bargain, since every rate carries the date its own document
 * states and the UI can show a saver exactly how old the number is.
 *
 * Only COVERED savings figures survive `savingsBenchmarks`; the card side of the
 * same file is read by the server, not here.
 */
import { savingsBenchmarks, type CatalogueEntryLike } from "@lavega/core";
import catalogue from "../../../docs/catalog/catalog.json";

const entries = (catalogue as { entries: CatalogueEntryLike[] }).entries ?? [];

/** Frozen at module load: the artifact never changes at runtime, and recomputing
 *  it per render would be work with no possible different answer. */
export const CATALOGUE_RATES = savingsBenchmarks(entries);
