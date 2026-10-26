import type { WidgetId } from "./components/moduleRegistry";
import type { EntityScope } from "@lavega/core";
import { getDefaultScope } from "./settings";
import type { View } from "./appRoutes";

/* The ONE switch for the personal-adviser pivot. While it is on, the
 * business-only surfaces (Facturen, Belasting, Valuta, the scope switch, the
 * entity classifier, invoice forwarding) are hidden. Nothing is deleted:
 * components and server routes stay, flip this to false to bring them back. */
export const ARCHIVE_BUSINESS = true;

export const ARCHIVED_VIEWS: readonly View[] = ARCHIVE_BUSINESS
  ? ["facturen", "belasting", "valuta"]
  : [];

export const ARCHIVED_WIDGETS: readonly WidgetId[] = ARCHIVE_BUSINESS
  ? ["positie", "facturen-open", "btw-stand"]
  : [];

export const SHOW_SCOPE_SWITCH: boolean = !ARCHIVE_BUSINESS;
export const SHOW_INVOICE_FORWARDING: boolean = !ARCHIVE_BUSINESS;
export const SHOW_ENTITY_CLASSIFIER: boolean = !ARCHIVE_BUSINESS;

export function isArchivedView(v: string): boolean {
  return (ARCHIVED_VIEWS as readonly string[]).includes(v);
}

export function isArchivedWidget(id: string): boolean {
  return (ARCHIVED_WIDGETS as readonly string[]).includes(id);
}

/** The scope the shell opens on. With the switch hidden there is no way back
 *  from business, so it is always personal; the stored default is neither read
 *  nor rewritten, and flipping the switch on restores the old behaviour. */
export function initialScope(showSwitch: boolean = SHOW_SCOPE_SWITCH): EntityScope {
  return showSwitch ? getDefaultScope() : "personal";
}
