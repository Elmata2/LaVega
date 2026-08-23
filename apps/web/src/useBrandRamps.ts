import { useEffect, useState } from "react";
import { loadBrandRamps, type BrandRamps } from "./brandColors.js";

/** De kaartvlakken, zodra ze gedecodeerd zijn. Tot dan leeg — en een lege map
 *  betekent "gebruik je eigen tokens", wat precies is wat de kaarten deden
 *  voordat er kleuren waren. Er is dus geen tussenstand waarin een kaart geen
 *  achtergrond heeft. */
export default function useBrandRamps(): BrandRamps {
  const [ramps, setRamps] = useState<BrandRamps>({});
  useEffect(() => {
    let live = true;
    void loadBrandRamps().then((r) => {
      if (live) setRamps(r);
    });
    return () => {
      live = false;
    };
  }, []);
  return ramps;
}
