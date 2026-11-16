import type { Account, AdvisorProfileStore } from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { intakeCopy } from "../../copy/intake.js";
import { wizardCopy } from "../../copy/wizard.js";
import { unconnectedItems } from "../../intake/unconnectedBrands.js";
import Module from "../Module.js";
import CardLink from "../ui/CardLink.js";
import { useOpenCardFile } from "../import/CardFileContext.js";

export type ConnectChecklistProps = {
  store: AdvisorProfileStore | null;
  accounts: readonly Pick<Account, "bank" | "linkedAt" | "source">[];
  onOpenAccounts: () => void;
  span?: 1 | 2 | 3;
};

/* The Plan page's list of banks still without a live link. Home shows the same
 * fact as a pop-up; this card is not a widget. */
export function ConnectChecklist({
  store,
  accounts,
  onOpenAccounts,
  span = 3,
}: ConnectChecklistProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale].home.connect;
  const names = wizardCopy[locale].bankNames;
  const openCardFile = useOpenCardFile();
  const items = unconnectedItems(store, accounts);
  if (items.length === 0) return null;
  return (
    <Module title={c.title} span={span}>
      <ul className="m-0 list-none p-0" data-testid="connect-checklist">
        {items.map(({ brand: b, route }) => (
          <li key={b} className="flex items-center justify-between gap-3 py-1">
            <span>{route === "file" ? c.fileLine(names[b] ?? b) : c.line(names[b] ?? b)}</span>
            <CardLink
              data-testid="connect-checklist-link"
              onClick={route === "file" && openCardFile ? () => openCardFile(null) : onOpenAccounts}
            >
              {route === "file" ? c.fileLink : c.link}
            </CardLink>
          </li>
        ))}
      </ul>
    </Module>
  );
}
