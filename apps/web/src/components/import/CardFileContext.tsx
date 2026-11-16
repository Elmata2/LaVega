import { createContext, useContext } from "react";
import type { CardTarget } from "../../lib/cardFileImport.js";

/* How a screen opens the "add a card by file" dialog without every screen
 * (and every test render) having to be handed props for it. App provides it;
 * a screen rendered without a provider simply shows no upload button. */
export type OpenCardFile = (
  card: CardTarget | null,
  opts?: {
    /** List only the cards no bank link can reach (the wizard's last step). */
    fileOnly?: boolean;
    /** Called with the number of added transactions after a successful commit. */
    onDone?: (count: number) => void;
  },
) => void;

export const CardFileContext = createContext<OpenCardFile | null>(null);

export const useOpenCardFile = (): OpenCardFile | null => useContext(CardFileContext);
