import { connectChecklist, type Account, type AdvisorProfileStore } from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { intakeCopy } from "../../copy/intake.js";
import { wizardCopy } from "../../copy/wizard.js";
import { brandOfCardId } from "../../intake/wizard/cardOptions.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import CardLink from "../ui/CardLink.js";

export type ConnectChecklistProps = {
  store: AdvisorProfileStore | null;
  accounts: readonly Pick<Account, "bank" | "linkedAt">[];
  onOpenAccounts: () => void;
  span?: 1 | 2 | 3;
};

/** The brands still without a live bank link, from the stated banks plus the
 *  banks the stated cards belong to. */
function unconnectedBrands(
  store: AdvisorProfileStore | null,
  accounts: ConnectChecklistProps["accounts"],
): string[] {
  const p = store?.current;
  const implied = [
    ...(p?.statedCards?.value ?? []).map((id) => brandOfCardId(id, "credit")),
    ...(p?.statedDebitCards?.value ?? []).map((id) => brandOfCardId(id, "debit")),
  ].filter((b): b is NonNullable<typeof b> => b !== null);
  return connectChecklist({
    statedBanks: p?.statedBanks?.value ?? [],
    impliedBanks: implied,
    accounts,
  })
    .filter((i) => !i.connected)
    .map((i) => i.brand);
}

export function ConnectChecklist({ store, accounts, onOpenAccounts, span = 3 }: ConnectChecklistProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale].home.connect;
  const names = wizardCopy[locale].bankNames;
  const brands = unconnectedBrands(store, accounts);
  if (brands.length === 0) return null;
  return (
    <Module title={c.title} span={span}>
      <ul className="m-0 list-none p-0" data-testid="connect-checklist">
        {brands.map((b) => (
          <li key={b} className="flex items-center justify-between gap-3 py-1">
            <span>{c.line(names[b] ?? b)}</span>
            <CardLink data-testid="connect-checklist-link" onClick={onOpenAccounts}>
              {c.link}
            </CardLink>
          </li>
        ))}
      </ul>
    </Module>
  );
}

export function ConnectChecklistWidget(props: ConnectChecklistProps) {
  return useWidgetEnabled("connect-checklist") ? <ConnectChecklist {...props} /> : null;
}
