/* Base URL for the LaVega server API (Enable Banking + rates). In production the
 * web app is served from the same origin as the server, so a relative "" works.
 * In dev the web runs on Vite (:5173) and the server on :8787. Overridable via
 * VITE_API_URL. */
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8787" : "");
