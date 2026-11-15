/* Owner-review harness for the midnight theme. Mounts the REAL app (App.tsx
 * with its real views) and the REAL intake wizard against synthetic vaults, with
 * the network stubbed. Reachable only through preview.html under
 * `LAVEGA_PREVIEW=1 vite` (see vite-preview-plugin.ts); the production build
 * takes index.html alone and never sees this directory. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createEncryptedStorage, vaultKeyFromBase64 } from "@lavega/adapters";
import { PREVIEW_KEY_B64, refusedRequests } from "./network";
import {
  budgetSeed,
  buildVaultSeed,
  completeProfile,
  profileResumingAt,
  type WizardStop,
} from "./fixtures";
import { readAppLocale, setAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import { markOnboardingSeen } from "../onboarding.js";
import { setOwnerName, setEnabledModules } from "../settings.js";
import { vaultOwnerName } from "../vaultKey.js";
import { emptyGuideState } from "../forwardingGuide.js";
import { enabledModules as resolveModules } from "../components/moduleRegistry";

const FIXTURE_OWNER = { kind: "account", id: "preview-fixture" } as const;
const EMPTY_OWNER = { kind: "account", id: "preview-empty" } as const;

export type Dataset = "fixture" | "empty";
export type Theme = "dark" | "light";

const THEME_KEY = "lavega-preview-theme";
export function readPreviewTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
export function applyPreviewTheme(theme: Theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private window: the switch still works for this page */
  }
}
export type Mode =
  | { id: string; group: string; label: string; kind: "app"; path: string; openCards?: boolean }
  | { id: string; group: string; label: string; kind: "wizard"; stop: WizardStop }
  | { id: string; group: string; label: string; kind: "dialog" | "gate" | "signin" | "status" };

export const MODES: Mode[] = [
  { id: "overview", group: "App", label: "Overview", kind: "app", path: "/app" },
  {
    id: "plan",
    group: "App",
    label: "Your plan (cards open)",
    kind: "app",
    path: "/app/plan",
    openCards: true,
  },
  { id: "accounts", group: "App", label: "Accounts", kind: "app", path: "/app/accounts" },
  {
    id: "transactions",
    group: "App",
    label: "Transactions",
    kind: "app",
    path: "/app/transactions",
  },
  { id: "forecast", group: "App", label: "Forecast", kind: "app", path: "/app/forecast" },
  { id: "bills", group: "App", label: "Bills", kind: "app", path: "/app/bills" },
  { id: "backup", group: "App", label: "Backup", kind: "app", path: "/app/backup" },
  { id: "optimise", group: "App", label: "Optimise", kind: "app", path: "/app/optimalisatie" },
  { id: "points", group: "App", label: "Points", kind: "app", path: "/app/punten" },
  { id: "profile", group: "App", label: "Profile", kind: "app", path: "/app/profiel" },
  { id: "about-you", group: "App", label: "About you", kind: "app", path: "/app/about-you" },
  { id: "w-start", group: "Wizard", label: "Household (first)", kind: "wizard", stop: "start" },
  { id: "w-work", group: "Wizard", label: "Work", kind: "wizard", stop: "work" },
  { id: "w-spend", group: "Wizard", label: "Spend (amount)", kind: "wizard", stop: "spend" },
  { id: "w-cards", group: "Wizard", label: "Card picker", kind: "wizard", stop: "cards" },
  { id: "w-goal", group: "Wizard", label: "Goal", kind: "wizard", stop: "goal" },
  { id: "w-risk", group: "Wizard", label: "Risk question", kind: "wizard", stop: "risk-first" },
  { id: "w-upload", group: "Wizard", label: "Upload", kind: "wizard", stop: "upload" },
  { id: "dialog", group: "Other", label: "Dialog", kind: "dialog" },
  { id: "gate", group: "Other", label: "Vault error", kind: "gate" },
  { id: "signin", group: "Other", label: "Sign-in form", kind: "signin" },
  { id: "status", group: "Other", label: "Status variants", kind: "status" },
];

const today = new Date();
const asOf = today.toISOString().slice(0, 10);

async function seedVault(
  owner: typeof FIXTURE_OWNER | typeof EMPTY_OWNER,
  full: boolean,
): Promise<void> {
  const storage = createEncryptedStorage();
  const key = await vaultKeyFromBase64(PREVIEW_KEY_B64);
  await storage.open(key, vaultOwnerName(owner));
  await storage.startFresh();
  if (full) {
    const entity = shellCopy[readAppLocale()].scope.personal;
    const seed = await buildVaultSeed(today, entity);
    await storage.putAccounts(seed.accounts);
    await storage.putTxs(seed.txs);
    await storage.putRewards(seed.rewards);
    await storage.putScheduledFlows(seed.flows);
    await storage.putBillPlan(seed.bills, seed.billOccurrences);
    await storage.putValuations(seed.valuations);
    await storage.putImportSessions(seed.importSessions);
    await storage.putProfile(completeProfile(today));
    const budget = budgetSeed(seed.accounts, seed.txs, today);
    await storage.putBudgetPeriods(budget.periods);
    await storage.putCategoryGroups(budget.groups);
  }
  storage.lock();
}

export async function boot(): Promise<void> {
  markOnboardingSeen();
  setOwnerName({ first: "Sanne", last: "de Vries" });
  setEnabledModules([...resolveModules(null)]);
  await seedVault(FIXTURE_OWNER, true);
  await seedVault(EMPTY_OWNER, false);
}

function useParams() {
  const read = () => {
    const q = new URLSearchParams(window.location.search);
    return {
      mode: q.get("m") ?? "overview",
      dataset: (q.get("d") === "empty" ? "empty" : "fixture") as Dataset,
    };
  };
  const [params, setParams] = useState(read);
  const go = (mode: string, dataset: Dataset) => {
    const m = MODES.find((x) => x.id === mode)!;
    const path = m.kind === "app" ? m.path : "/app/preview";
    window.history.pushState({}, "", `${path}?m=${mode}&d=${dataset}`);
    setParams({ mode, dataset });
  };
  return { ...params, go };
}

function OpenAll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setInterval(() => {
      ref.current
        ?.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')
        .forEach((b) => b.click());
    }, 400);
    const stop = window.setTimeout(() => window.clearInterval(t), 3000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}

export function Stage({ mode, dataset }: { mode: Mode; dataset: Dataset }) {
  const [parts, setParts] = useState<null | {
    App: typeof import("../App").default;
    IntakeWizard: typeof import("../views/IntakeWizard").default;
    ForwardingGuide: typeof import("../views/ForwardingGuide").default;
    VaultGate: typeof import("../components/VaultGate").default;
    SignInForm: typeof import("../components/SignInForm").default;
    Card: typeof import("../components/ui/Card").default;
    StatusSheet: typeof import("./StatusSheet").default;
  }>(null);
  useEffect(() => {
    void Promise.all([
      import("../App"),
      import("../views/IntakeWizard"),
      import("../views/ForwardingGuide"),
      import("../components/VaultGate"),
      import("../components/SignInForm"),
      import("../components/ui/Card"),
      import("./StatusSheet"),
    ]).then(([a, w, f, g, s, c, st]) =>
      setParts({
        App: a.default,
        IntakeWizard: w.default,
        ForwardingGuide: f.default,
        VaultGate: g.default,
        SignInForm: s.default,
        Card: c.default,
        StatusSheet: st.default,
      }),
    );
  }, []);
  if (!parts) return <p className="pv-loading">Loading real components…</p>;
  const locale = readAppLocale();
  const key = `${mode.id}-${dataset}`;

  if (mode.kind === "app") {
    const app = <parts.App key={key} owner={dataset === "empty" ? EMPTY_OWNER : FIXTURE_OWNER} />;
    return mode.openCards ? <OpenAll>{app}</OpenAll> : app;
  }
  if (mode.kind === "wizard") {
    return (
      <parts.IntakeWizard
        key={key}
        store={profileResumingAt(mode.stop, today)}
        asOf={asOf}
        onSave={async () => {}}
        onImport={async () => ({ ok: true, count: 12 })}
        onFinish={() => {}}
        onExit={() => {}}
      />
    );
  }
  if (mode.kind === "dialog") {
    return (
      <OpenFirstButton key={key}>
        <div className="pv-pad">
          <parts.ForwardingGuide
            address="sanne-7k2p@inbox.lavega.example"
            state={emptyGuideState()}
            nowMs={today.getTime()}
            onChange={() => {}}
            onStartTest={() => {}}
            onOpenAccounts={() => {}}
          />
        </div>
      </OpenFirstButton>
    );
  }
  if (mode.kind === "gate") {
    return (
      <parts.VaultGate
        key={key}
        gate={{ error: "unreadable" }}
        storage={createEncryptedStorage()}
        onReady={() => {}}
        onRetry={() => {}}
        onSignOut={() => {}}
      />
    );
  }
  if (mode.kind === "status") return <parts.StatusSheet key={key} />;
  return (
    <div className="pv-pad">
      <parts.Card className="pv-narrow">
        <parts.SignInForm
          key={key}
          locale={locale}
          intro="Sign in to your vault."
          onSuccess={() => {}}
        />
      </parts.Card>
    </div>
  );
}

function OpenFirstButton({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(
      () => ref.current?.querySelector<HTMLButtonElement>("button")?.click(),
      300,
    );
    return () => window.clearTimeout(t);
  }, []);
  return <div ref={ref}>{children}</div>;
}

function Switcher({
  mode,
  dataset,
  go,
}: {
  mode: string;
  dataset: Dataset;
  go: (m: string, d: Dataset) => void;
}) {
  const [refused, setRefused] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setRefused(refusedRequests().length), 1000);
    return () => window.clearInterval(t);
  }, []);
  const locale = readAppLocale();
  const [theme, setTheme] = useState<Theme>(readPreviewTheme);
  const pickTheme = (t: Theme) => {
    applyPreviewTheme(t);
    setTheme(t);
  };
  const groups = [...new Set(MODES.map((m) => m.group))];
  return (
    <aside className="pv-bar" aria-label="Preview switcher">
      <strong>Design preview</strong>
      {groups.map((g) => (
        <span key={g} className="pv-group">
          <em>{g}</em>
          {MODES.filter((m) => m.group === g).map((m) => (
            <button key={m.id} aria-pressed={m.id === mode} onClick={() => go(m.id, dataset)}>
              {m.label}
            </button>
          ))}
        </span>
      ))}
      <span className="pv-group">
        <em>Data</em>
        <button aria-pressed={dataset === "fixture"} onClick={() => go(mode, "fixture")}>
          Sample
        </button>
        <button aria-pressed={dataset === "empty"} onClick={() => go(mode, "empty")}>
          Empty
        </button>
        <button
          onClick={() => {
            setAppLocale(locale === "en" ? "nl" : "en");
            window.location.reload();
          }}
        >
          {locale === "en" ? "EN" : "NL"}
        </button>
      </span>
      <span className="pv-group">
        <em>Theme</em>
        <button aria-pressed={theme === "dark"} onClick={() => pickTheme("dark")}>
          Dark
        </button>
        <button aria-pressed={theme === "light"} onClick={() => pickTheme("light")}>
          Light
        </button>
      </span>
      <span className="pv-net">refused network calls: {refused}</span>
    </aside>
  );
}

export function Preview() {
  const { mode, dataset, go } = useParams();
  const current = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  return (
    <>
      <Stage mode={current} dataset={dataset} />
      <Switcher mode={current.id} dataset={dataset} go={go} />
    </>
  );
}
