import { VaultDestroyError, type CipherBlob, type VaultStorage } from "@lavega/adapters";
import type { VaultOwner } from "./vaultKey.js";
import { parseBackup } from "./backup.js";
import { apiErrorMessageIn } from "./api.js";
import { setNetWorthShareSuspended } from "./netWorthShare.js";
import type { Locale } from "./locale.js";

/* Talking to /api/vault/backup. The server stores the vault's own CipherBlob
 * and cannot read it, so everything here is about moving sealed bytes and
 * about not letting one device's copy quietly replace another's. */

export type ServerBackup = { blob: CipherBlob | null; updatedAt: string | null };
export type UploadResult =
  | { status: "stored"; updatedAt: string }
  | { status: "conflict"; updatedAt: string | null }
  | { status: "signed-out" };

/** Mirrors `@lavega/database`'s `ErasureReport`, restated here rather than
 *  imported: that package pulls in `@neondatabase/serverless` and `node:crypto`,
 *  which have no business in a browser bundle. */
export type ErasureReport = { table: string; rows: number }[];

/** `null` when the account has no backup yet; that is a normal state, not an error. */
export async function fetchServerBackup(): Promise<ServerBackup | "signed-out"> {
  const response = await fetch("/api/vault/backup");
  if (response.status === 401) return "signed-out";
  if (!response.ok) throw new Error("Back-up ophalen mislukt");
  const body = (await response.json()) as { blob?: unknown; updatedAt?: unknown };
  const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt : null;
  // Validate on the way in too: this blob is about to be handed to deriveKey.
  return { blob: body.blob == null ? null : parseBackup(JSON.stringify(body.blob)), updatedAt };
}

/**
 * `baseUpdatedAt` is the server copy this upload is replacing. A mismatch means
 * another device wrote in the meantime, and the answer is a conflict rather than
 * an overwrite — `overwrite` is for a user who has been shown that and chose.
 */
export async function uploadServerBackup(
  blob: CipherBlob,
  baseUpdatedAt: string | null,
  overwrite = false,
): Promise<UploadResult> {
  const response = await fetch(`/api/vault/backup${overwrite ? "?overwrite=true" : ""}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blob, baseUpdatedAt }),
  });
  if (response.status === 401) return { status: "signed-out" };
  const body = (await response.json().catch(() => ({}))) as { updatedAt?: unknown };
  const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt : null;
  if (response.status === 409) return { status: "conflict", updatedAt };
  if (!response.ok || !updatedAt) throw new Error("Back-up opslaan mislukt");
  return { status: "stored", updatedAt };
}

/**
 * The right to be forgotten (GDPR art. 17), from the browser side: `DELETE
 * /api/account/data`. The server refuses a bare DELETE — it wants `{confirm:
 * "ERASE"}` in the body, so that a mis-routed fetch can't erase an account —
 * and answers 401 when the session lapsed, which `apiErrorMessageIn` already
 * turns into the shared signed-out copy — in the reader's language. It took a
 * locale because this was the last caller still on the no-locale export, and
 * its message lands on the "erase my data" button: the one place where being
 * misunderstood is least acceptable.
 */
export async function eraseServerData(locale: Locale): Promise<ErasureReport> {
  const response = await fetch("/api/account/data", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: "ERASE" }),
  });
  if (!response.ok) throw new Error(await apiErrorMessageIn(locale, response));
  const body = (await response.json().catch(() => ({}))) as { erased?: ErasureReport };
  return body.erased ?? [];
}

/* ---------------------------------------------------------------------------
 * Reset personal data (docs/superpowers/specs/2026-11-14-personal-data-reset-design.md).
 * Not a GDPR erase: the login, the vault key and Investing stay. */

/** Browser keys that hold personal state. Theme, widths, language, chart choice,
 *  owner name, country, region, tax country and behaviour preferences are NOT
 *  here on purpose: they say how the app looks, not what the person owns. */
export const PERSONAL_LOCAL_KEYS = [
  "lavega.bufferCents",
  "lavega.ebLastRefreshAt",
  "lavega.ebEverConnected",
  "lavega.shareNetWorthPendingDelete",
  "lavega.n8nHandledMessageIds",
  "lavega.n8n.autoBooked.v1",
  "lavega.forwardingGuide.v1",
  "lavega.invoiceForwardAddress",
  "lavega.onboardingSeen",
  "lavega.popups",
  "lavega.overviewWidgets",
  "lavega.navModules",
  // Secrets of the invoice-forwarding setup (settings.ts): personal, and they
  // point at a forwarding address that this reset deletes on the server.
  "lavega.n8nInvoiceUrl",
  "lavega.n8nInvoiceToken",
  "lavega.n8nBaseUrl",
  "lavega.n8nApiKey",
] as const;
export const PERSONAL_SESSION_KEYS = ["lavega.popupShown"] as const;

/** What went wrong, as a code. The screen turns it into copy in the reader's
 *  language; nothing here is shown raw. */
export type PersonalResetErrorCode =
  | "network"
  | "unauthorized"
  | "owner-changed"
  | "server"
  | "local-blocked"
  | "local-failed";

/** `server` codes mean nothing in this browser was touched. */
export class PersonalResetError extends Error {
  constructor(
    readonly code: PersonalResetErrorCode,
    message = "",
  ) {
    super(message || code);
    this.name = "PersonalResetError";
  }
}

type KeyStore = Pick<Storage, "removeItem">;

/**
 * Clear the personal side, in an order that never leaves a half state the app
 * cannot open from:
 *  1. account owner: `DELETE /api/account/personal-data` with the owner this
 *     tab has open as `expectedOwner`. It must answer 2xx before anything local
 *     is touched. 401, 409 (the session is another account now), any other
 *     non-2xx, and a thrown network error all stop here with nothing local
 *     changed; retrying is safe because the server delete is idempotent.
 *  2. drop this owner's vault database (other tabs are told first, see
 *     `destroyVault`). A delete that stays blocked fails with `local-blocked`
 *     and the keys stay.
 *  3. remove the personal browser keys.
 *  4. reload at /app, where an empty vault is created under the same key.
 * A device owner (no account backend) has no server copy: step 1 is skipped.
 */
export async function resetPersonalData(options: {
  locale: Locale;
  storage: Pick<VaultStorage, "destroyVault">;
  owner: VaultOwner;
  local?: KeyStore;
  session?: KeyStore;
  navigate?: (url: string) => void;
}): Promise<ErasureReport> {
  let report: ErasureReport = [];
  // From here the page is still mounted with accounts in memory; a share PUT
  // now would re-create the total this reset deletes. Lifted on failure only:
  // on success the page navigates away.
  setNetWorthShareSuspended(true);
  try {
    return await clearPersonal(options, report);
  } catch (error) {
    setNetWorthShareSuspended(false);
    throw error;
  }
}

async function clearPersonal(
  options: Parameters<typeof resetPersonalData>[0],
  report: ErasureReport,
): Promise<ErasureReport> {
  if (options.owner.kind === "account") {
    let response: Response;
    try {
      response = await fetch("/api/account/personal-data", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "RESET-PERSONAL", expectedOwner: options.owner.id }),
      });
    } catch {
      throw new PersonalResetError("network");
    }
    if (response.status === 401) throw new PersonalResetError("unauthorized");
    if (response.status === 409) throw new PersonalResetError("owner-changed");
    if (!response.ok) {
      throw new PersonalResetError("server", await apiErrorMessageIn(options.locale, response));
    }
    const body = (await response.json().catch(() => ({}))) as { erased?: ErasureReport };
    report = body.erased ?? [];
  }

  try {
    await options.storage.destroyVault();
  } catch (error) {
    throw new PersonalResetError(
      error instanceof VaultDestroyError && error.reason === "blocked"
        ? "local-blocked"
        : "local-failed",
    );
  }

  const local = options.local ?? window.localStorage;
  const session = options.session ?? window.sessionStorage;
  for (const key of PERSONAL_LOCAL_KEYS) local.removeItem(key);
  for (const key of PERSONAL_SESSION_KEYS) session.removeItem(key);

  (options.navigate ?? ((url) => window.location.assign(url)))("/app");
  return report;
}
