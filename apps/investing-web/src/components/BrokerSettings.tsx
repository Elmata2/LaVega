import { useEffect, useState } from "react";
import { Button } from "./ui/button.js";
import { filterVisibleSyncProblems, startBrokerSync, useSyncSession } from "../lib/syncSession.js";

const SYNC_BACKGROUND_MESSAGE = "Sync continues in the background; progress is shown above.";

function otherBrokerUnconfigured(problem: string, broker: "ibkr" | "trading212"): boolean {
  const other = broker === "ibkr" ? /trading\s*212/i : /ibkr/i;
  return other.test(problem) && /credentials are not configured/i.test(problem);
}

function BrokerSetupCard({
  name,
  eyebrow,
  description,
  fields,
  steps,
  warning,
}: {
  name: string;
  eyebrow: string;
  description: string;
  fields: string[];
  steps: string[];
  warning?: string;
}) {
  return (
    <article className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{eyebrow}</p>
      <h3 className="mt-2 font-display text-3xl font-semibold">{name}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-sm font-semibold">Data you need</p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {fields.map((field) => (
            <li key={field} className="flex gap-2">
              <span className="text-primary">✓</span>
              <span>{field}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-sm font-semibold">How to find them</p>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      {warning && (
        <p
          role="note"
          className="mt-6 rounded-[14px] bg-warning/10 px-4 py-3 text-xs leading-5 text-foreground"
        >
          {warning}
        </p>
      )}
    </article>
  );
}

function BrokerSyncAction() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [problems, setProblems] = useState<string[]>([]);

  async function sync() {
    setStatus("loading");
    setProblems([]);
    try {
      const result = await startBrokerSync(true);
      const nextProblems = filterVisibleSyncProblems(result?.problems ?? []);
      setProblems(nextProblems);
      setStatus(nextProblems.length > 0 ? "error" : "success");
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "Broker sync failed."]);
      setStatus("error");
    }
  }

  return (
    <div className="rounded-card border border-border bg-secondary/40 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-sm font-semibold">Data saved?</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Start a new broker sync now. This bypasses the daily sync cache.
        </p>
      </div>
      <div className="mt-4 shrink-0 sm:mt-0">
        <Button type="button" onClick={sync} disabled={status === "loading"}>
          {status === "loading" ? "Syncing…" : "Start sync"}
        </Button>
      </div>
      {status === "success" && (
        <p role="status" className="mt-3 text-sm text-positive sm:mt-0">
          Sync completed.
        </p>
      )}
      {problems.length > 0 && (
        <div
          role="alert"
          className="mt-4 basis-full rounded-[14px] border border-negative/20 bg-negative/5 px-4 py-3 text-sm"
        >
          <p className="font-semibold">Sync not completed</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((problem, index) => (
              <li key={`${problem}-${index}`}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BrokerSyncProgressCard() {
  const { broker: progress } = useSyncSession();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!progress?.waitUntil || progress.status !== "waiting") return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [progress?.waitUntil, progress?.status]);

  if (!progress || progress.status === "idle" || progress.status === "problem") return null;
  const waiting = progress.status === "waiting";
  const completed = progress.status === "completed";
  const seconds = progress.waitUntil
    ? Math.max(0, Math.ceil((Date.parse(progress.waitUntil) - now) / 1_000))
    : null;
  return (
    <section
      aria-live="polite"
      className={`rounded-card border p-5 ${completed ? "border-positive/30 bg-positive/5" : waiting ? "border-warning/30 bg-warning/10" : "border-primary/20 bg-secondary/40"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">
            Broker sync
          </p>
          <h3 className="mt-2 font-display text-2xl font-semibold">
            {completed ? "Trading 212 synced" : "Trading 212 syncing"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {progress.pages} pages · {progress.ordersRead.toLocaleString("en-GB")} orders read ·{" "}
            {progress.positionsRead} positions
          </p>
        </div>
        <span
          className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${completed ? "bg-positive/10 text-positive" : waiting ? "bg-warning/20 text-foreground" : "bg-primary/10 text-primary"}`}
        >
          {completed ? "Completed" : waiting ? "API pause" : "In progress"}
        </span>
      </div>
      {waiting && (
        <p className="mt-4 text-sm font-medium">
          Waiting for new API capacity{seconds !== null ? ` · continuing in ${seconds} sec.` : ""}
        </p>
      )}
      {!waiting && !completed && (
        <p className="mt-4 text-sm text-muted-foreground">
          Full order history is loading. You may keep this window open, but you don't have to.
        </p>
      )}
    </section>
  );
}

/**
 * Whether this runtime's vault is opened by a passphrase the user types.
 * A vault the server holds the key to has nothing to ask for, so the field and
 * every promise around it have to disappear rather than sit there unused.
 */
function useVaultPassphraseMode(): "checking" | "required" | "unused" {
  const [mode, setMode] = useState<"checking" | "required" | "unused">("checking");
  useEffect(() => {
    let current = true;
    void fetch("/api/brokers/credentials/status")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { passphrase?: string }) : {},
      )
      .then((result) => {
        if (current) setMode(result.passphrase === "unused" ? "unused" : "required");
      })
      .catch(() => {
        if (current) setMode("required");
      });
    return () => {
      current = false;
    };
  }, []);
  return mode;
}

function BrokerVaultUnlock() {
  const [vaultStatus, setVaultStatus] = useState<"checking" | "hidden" | "locked" | "unlocked">(
    "checking",
  );
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetch("/api/brokers/credentials/status")
      .then(async (response) =>
        response.ok ? ((await response.json()) as { status?: string }) : {},
      )
      .then((result) => {
        if (current) setVaultStatus(result.status === "locked" ? "locked" : "hidden");
      })
      .catch(() => {
        if (current) setVaultStatus("hidden");
      });
    return () => {
      current = false;
    };
  }, []);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const unlockResponse = await fetch("/api/brokers/credentials/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const unlockResult = (await unlockResponse.json().catch(() => ({}))) as {
        problems?: string[];
      };
      if (!unlockResponse.ok)
        throw new Error(unlockResult.problems?.[0] ?? "Failed to unlock vault.");
      setPassphrase("");
      const syncResult = await startBrokerSync(true);
      if (!syncResult) {
        setVaultStatus("unlocked");
        setMessage(`Vault unlocked. ${SYNC_BACKGROUND_MESSAGE}`);
        return;
      }
      setVaultStatus("unlocked");
      setMessage(
        (syncResult.problems ?? []).length === 0
          ? "Vault unlocked. Sync completed."
          : `Vault unlocked. ${syncResult.problems?.join(" · ")}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to unlock vault.");
    } finally {
      setBusy(false);
    }
  }

  if (vaultStatus === "checking" || vaultStatus === "hidden") return null;
  if (vaultStatus === "unlocked")
    return (
      <p
        role="status"
        className="rounded-card border border-positive/30 bg-positive/5 p-4 text-sm text-positive"
      >
        {message}
      </p>
    );
  return (
    <form
      onSubmit={unlock}
      className="rounded-card border border-warning/30 bg-warning/10 p-5 sm:flex sm:items-end sm:gap-4 sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">
          Existing vault
        </p>
        <h3 className="mt-2 font-display text-2xl font-semibold">Unlock vault</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Credentials are stored encrypted on disk. Enter only the vault password; broker keys are
          not needed again.
        </p>
        <label className="mt-4 block text-sm font-semibold">
          Vault password
          <input
            required
            name="unlockPassphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
          />
        </label>
        {message && (
          <p role="alert" className="mt-3 text-sm text-negative">
            {message}
          </p>
        )}
      </div>
      <Button
        data-action="unlock-vault"
        type="submit"
        disabled={busy}
        className="mt-4 shrink-0 sm:mt-0"
      >
        {busy ? "Unlocking…" : "Unlock and sync"}
      </Button>
    </form>
  );
}

function BrokerCredentialForm({ onSaved }: { onSaved?: (broker: "ibkr" | "trading212") => void }) {
  const [broker, setBroker] = useState<"ibkr" | "trading212">("ibkr");
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const passphraseMode = useVaultPassphraseMode();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function resetBroker(next: "ibkr" | "trading212") {
    setBroker(next);
    setToken("");
    setQueryId("");
    setSecret("");
    setMessage(null);
    setStatus("idle");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
    const payload = {
      broker,
      token,
      ...(broker === "ibkr" ? { queryId } : { secret }),
      ...(passphraseMode === "unused" ? {} : { passphrase }),
    };
    try {
      const saveResponse = await fetch("/api/brokers/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saveResult = (await saveResponse.json().catch(() => ({}))) as { problems?: string[] };
      if (!saveResponse.ok)
        throw new Error(saveResult.problems?.[0] ?? "Failed to save credentials.");
      onSaved?.(broker);
      const syncResult = await startBrokerSync(true);
      if (!syncResult) {
        setStatus("success");
        setMessage(`Credentials saved. ${SYNC_BACKGROUND_MESSAGE}`);
        setToken("");
        setQueryId("");
        setSecret("");
        setPassphrase("");
        return;
      }
      const blocking = (syncResult.problems ?? []).filter(
        (problem) => !otherBrokerUnconfigured(problem, broker),
      );
      if (blocking.length > 0)
        throw new Error(blocking[0] ?? syncResult.problems?.[0] ?? "Broker sync failed.");
      setStatus("success");
      setMessage("Credentials saved. Sync completed.");
      setToken("");
      setQueryId("");
      setSecret("");
      setPassphrase("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to connect broker.");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-border bg-card p-5 shadow-soft sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Step 2</p>
          <h3 className="mt-2 font-display text-3xl font-semibold">Save credentials</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {passphraseMode === "unused"
              ? "LaVega encrypts these details with the server key before storing them. Sync then starts automatically."
              : "LaVega encrypts these details in the local vault. Sync then starts automatically."}
          </p>
        </div>
        <label className="text-sm font-semibold">
          Broker
          <select
            aria-label="Broker"
            value={broker}
            onChange={(event) => resetBroker(event.target.value as "ibkr" | "trading212")}
            className="mt-2 block rounded-pill border border-input bg-background px-3 py-2 text-sm font-normal"
          >
            <option value="ibkr">Interactive Brokers</option>
            <option value="trading212">Trading 212</option>
          </select>
        </label>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          {broker === "ibkr" ? "Flex-token" : "API key"}
          <input
            required
            name="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
          />
        </label>
        {broker === "ibkr" ? (
          <label className="text-sm font-semibold">
            Query ID
            <input
              required
              name="queryId"
              inputMode="numeric"
              value={queryId}
              onChange={(event) => setQueryId(event.target.value)}
              className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
            />
          </label>
        ) : (
          <label className="text-sm font-semibold">
            API secret
            <input
              required
              name="secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
            />
          </label>
        )}
        {passphraseMode !== "unused" && (
          <label className="text-sm font-semibold sm:col-span-2">
            Vault password
            <input
              required
              name="passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="mt-2 block w-full rounded-[14px] border border-input bg-background px-3 py-2.5 text-sm font-normal"
            />
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              New vault? This password becomes the vault key. Keep it safe; LaVega cannot recover
              it.
            </span>
          </label>
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Saving and syncing…" : "Save and sync"}
        </Button>
        {status === "success" && (
          <span role="status" className="text-sm text-positive">
            {message}
          </span>
        )}
        {status === "error" && (
          <span role="alert" className="text-sm text-negative">
            {message}
          </span>
        )}
      </div>
    </form>
  );
}

export function BrokerSettings() {
  const [unreadableBrokers, setUnreadableBrokers] = useState<Array<"ibkr" | "trading212">>([]);
  const [storageProblem, setStorageProblem] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/brokers/credentials/status")
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Broker credential storage is unavailable. Try again later.");
        return (await response.json()) as {
          brokers?: Record<"ibkr" | "trading212", string>;
        };
      })
      .then(({ brokers }) => {
        const unreadable = (["ibkr", "trading212"] as const).filter(
          (broker) => brokers?.[broker] === "unreadable",
        );
        setUnreadableBrokers(unreadable);
      })
      .catch((error: unknown) =>
        setStorageProblem(
          error instanceof Error ? error.message : "Broker credential storage is unavailable.",
        ),
      );
  }, []);
  const credentialProblem =
    storageProblem ??
    (unreadableBrokers.length
      ? `${unreadableBrokers.map((broker) => (broker === "ibkr" ? "IBKR" : "Trading 212")).join(" and ")} credentials cannot be read. Save new credentials below to reconnect.`
      : null);
  return (
    <div className="space-y-8">
      <BrokerVaultUnlock />
      {credentialProblem && (
        <p
          role="alert"
          className="rounded-card border border-border bg-secondary/40 p-4 text-sm leading-6 text-foreground"
        >
          {credentialProblem}
        </p>
      )}
      <BrokerSyncProgressCard />
      <div className="grid gap-5 lg:grid-cols-2">
        <BrokerSetupCard
          name="Interactive Brokers"
          eyebrow="IBKR"
          description="Use IBKR Flex Web Service. This works with daily updated reports, without a local gateway or browser login."
          fields={[
            "Flex-token",
            "Numeric Query ID",
            "Flex Query with Open Positions, Trades, Cash Report and Statement of Funds",
          ]}
          steps={[
            "Open the Interactive Brokers Client Portal.",
            "Go to Performance & Reports → Flex Queries.",
            "Create one query with Open Positions, Trades, Cash Report and Statement of Funds.",
            "Save the query and note the numeric Query ID.",
            "Go to Flex Web Service and generate a token. Note the token immediately; IBKR only shows it briefly.",
          ]}
        />
        <BrokerSetupCard
          name="Trading 212"
          eyebrow="Trading 212"
          description="Use the official Trading 212 API. LaVega reads positions, orders, transactions and dividends through your own credentials, and never writes."
          fields={["API key", "API secret"]}
          steps={[
            "Open the Trading 212 app and go to Menu → Settings → API (Beta).",
            "Create the key on an Invest or Stocks ISA account. The API does not work on any other account type.",
            "Enable exactly five permissions: Account data, History – Dividends, History – Orders, History – Transactions, Portfolio.",
            "Leave Orders – Execute and Pies – Write off. LaVega has no code that trades.",
            "Copy both the API key and the API secret. The secret is shown once — without it nothing authenticates.",
          ]}
          warning="Those five are one per endpoint LaVega reads. A missing one does not fail at setup: it surfaces later as HTTP 403 on the first sync."
        />
      </div>
      <BrokerCredentialForm
        onSaved={(broker) =>
          setUnreadableBrokers((current) => current.filter((item) => item !== broker))
        }
      />
      <BrokerSyncAction />
      <p className="rounded-card border border-border bg-secondary/40 p-4 text-sm leading-6 text-muted-foreground">
        Credentials stay on your machine. Never share Flex tokens, API keys or API secrets in chat,
        screenshots, issues or git.
      </p>
    </div>
  );
}
