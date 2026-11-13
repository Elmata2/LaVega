import { useMemo, useState, type MouseEvent } from "react";
import { accountIsLiability, type Account } from "@lavega/core";
import type { View } from "../App";
import { useAppLocale } from "../appLocale.js";
import { pathForView } from "../appRoutes";
import { shellCopy } from "../copy/shell.js";
import { moneyCopy } from "../copy/money.js";
import { formatSignedEuroIn } from "../format.js";
import { groupAccountsByBank } from "../views/Rekeningen";
import { LineIcon, navClick } from "./Rail.js";

/* The account sidebar BODY (spec 5.2). Pure content: no width, no collapse, no
 * resize handle, so the phone drawer (step 9b) can render the same component.
 * The frame (Shell) owns width and the handle. */

export type AccountSidebarProps = {
  /** The list Rekeningen gets: `scopedAccounts`. */
  accounts: Account[];
  view: View;
  /** Same predicate as the rail: the plan row exists only when true. */
  planUnlocked: boolean;
  /** The account the transaction list is filtered to; "" for none. The caller
   *  passes "" when the transaction view is not showing. */
  activeAccountKey: string;
  /** The ONE account-click handler Rekeningen uses too. */
  onSelectAccount: (accountKey: string) => void;
  onOpenPlan: () => void;
  onAddAccount: () => void;
  /** Called after any of the three actions above runs (not for tabs or group
   *  heads). The phone drawer closes itself with it. */
  onNavigate?: () => void;
};

type Tab = "all" | "assets" | "debts";

export function AccountSidebar({
  accounts,
  view,
  planUnlocked,
  activeAccountKey,
  onSelectAccount,
  onOpenPlan,
  onAddAccount,
  onNavigate,
}: AccountSidebarProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  const money = moneyCopy[locale].rekeningen;
  const [tab, setTab] = useState<Tab>("all");

  const groups = useMemo(() => {
    const shown =
      tab === "all"
        ? accounts
        : accounts.filter((a) => accountIsLiability(a) === (tab === "debts"));
    return groupAccountsByBank(shown.map((account) => ({ account, txCount: 0 })));
  }, [accounts, tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: c.accountSidebar.tabAll },
    { id: "assets", label: c.accountSidebar.tabAssets },
    { id: "debts", label: c.accountSidebar.tabDebts },
  ];
  const emptyText =
    accounts.length === 0
      ? c.accountSidebar.empty
      : tab === "debts"
        ? c.accountSidebar.emptyDebts
        : c.accountSidebar.emptyAssets;

  const balance = (b: number | null) =>
    b === null ? (
      <span className="shell2-acc-bal shell2-acc-unknown">{money.saldoOnbekend}</span>
    ) : (
      <span className={`shell2-acc-bal ${b >= 0 ? "text-pos" : "text-neg"}`}>
        {formatSignedEuroIn(locale, b)}
      </span>
    );

  const addRow = (
    <button type="button" className="shell2-acc-add" onClick={() => {
        onAddAccount();
        onNavigate?.();
      }}
    >
      {c.accountSidebar.add}
    </button>
  );

  return (
    <div className="shell2-acc">
      {planUnlocked && (
        <a
          href={pathForView("plan")}
          className="shell2-acc-plan"
          aria-current={view === "plan" ? "page" : undefined}
          onClick={(e: MouseEvent) => navClick(e, () => {
              onOpenPlan();
              onNavigate?.();
            })}
        >
          <LineIcon>
            <path d="M5 4h14v16H5z" />
            <path d="M9 9h6M9 13h6M9 17h3" />
          </LineIcon>
          <span>{c.nav.moduleLabels.plan}</span>
        </a>
      )}

      {accounts.length > 0 && (
        <div className="shell2-acc-tabs" role="group" aria-label={c.accountSidebar.tabsLabel}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="shell2-acc-tab"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {accounts.length > 0 && addRow}

      {groups.length === 0 ? (
        <div className="shell2-acc-empty">
          <p>{emptyText}</p>
          {accounts.length === 0 && addRow}
        </div>
      ) : (
        groups.map((g) => (
          <details key={g.id} className="shell2-acc-group" open>
            <summary className="shell2-acc-head">
              <svg
                className="shell2-acc-chevron"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 2.5 7.5 6 4 9.5" />
              </svg>
              <span className="shell2-acc-bank">{g.named ? g.label : money.zonderBank}</span>
              <span className="shell2-acc-total">
                {g.total === null ? money.saldoOnbekend : formatSignedEuroIn(locale, g.total)}
                {g.total !== null && g.unknownCount > 0 && (
                  <span className="shell2-acc-partial">
                    {" "}
                    {money.vanKnownVanTotal(g.knownCount, g.rows.length)}
                  </span>
                )}
              </span>
            </summary>
            <ul className="shell2-acc-list">
              {g.rows.map(({ account }) => (
                <li key={account.key}>
                  <button
                    type="button"
                    className="shell2-acc-row"
                    aria-current={account.key === activeAccountKey ? "true" : undefined}
                    onClick={() => {
                      onSelectAccount(account.key);
                      onNavigate?.();
                    }}
                  >
                    <span className="shell2-acc-name">{account.name || account.key}</span>
                    {balance(account.balance)}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
    </div>
  );
}
