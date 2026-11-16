/** Local ids for rows the person adds by hand. Not secrets, only unique.
 *  `crypto.randomUUID` is missing on a non-secure origin, `getRandomValues` is
 *  not, so that is the fallback. With no `crypto` at all the id comes from a
 *  counter: unique within the page, and never from `Math.random`. */
let counter = 0;

const hex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const localId = (): string => {
  if (typeof crypto === "undefined") return `local-${(counter += 1)}`;
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return hex(16);
};

/** Eight characters, for the short ids the wizard rows use. */
export const shortLocalId = (): string => {
  if (typeof crypto === "undefined") return `l${(counter += 1)}`.padEnd(8, "0").slice(0, 8);
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID().slice(0, 8);
  return hex(4);
};
