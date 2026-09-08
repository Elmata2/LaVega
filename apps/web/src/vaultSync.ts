import type { CipherBlob } from "@lavega/adapters";
import { parseBackup } from "./backup.js";
import { apiErrorMessage } from "./api.js";

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
 * and answers 401 when the session lapsed, which `apiErrorMessage` already
 * turns into the shared signed-out copy.
 */
export async function eraseServerData(): Promise<ErasureReport> {
  const response = await fetch("/api/account/data", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: "ERASE" }),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response));
  const body = (await response.json().catch(() => ({}))) as { erased?: ErasureReport };
  return body.erased ?? [];
}
