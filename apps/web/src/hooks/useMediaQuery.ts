import { useEffect, useState } from "react";

function matches(query: string, fallback: boolean): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return fallback;
  return window.matchMedia(query).matches;
}

/** Live `matchMedia` result. `fallback` is used where the API is missing
 *  (prerender, old test DOMs). */
export function useMediaQuery(query: string, fallback = true): boolean {
  const [value, setValue] = useState(() => matches(query, fallback));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setValue(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return value;
}
