import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, signOut, type SessionState } from "../lib/auth-client.js";
import { useDashboard } from "../lib/dashboardResource.js";
import { useInvestingLayout } from "../lib/layoutResource.js";
import { PERSONAL_URL } from "../lib/personal.js";
import type { PriceSyncProgress } from "../lib/priceSync.js";
import { useSyncSession, type BrokerProgress } from "../lib/syncSession.js";
import { BrokerSettings } from "./BrokerSettings.js";
import { LayoutPicker, Switch } from "./LayoutPicker.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

/* Everything that is a setting rather than a place to work: broker
 * credentials, which tabs and which Overview cards are switched on, and the
 * account. Reached from the profile button in the top bar (Task 3) and from
 * the redirects at /brokers/connect and "Add widget". */

function AccountSection() {
  const navigate = useNavigate();
  const [state, setState] = useState<SessionState | "loading">("loading");
  useEffect(() => {
    let current = true;
    void getSession().then((next) => current && setState(next));
    return () => {
      current = false;
    };
  }, []);
  async function handleSignOut() {
    await signOut();
    navigate("/sign-in", { replace: true });
  }
  return (
    <section id="account" aria-label="Account">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            {state === "loading" ? null : state.status === "unconfigured" ? (
              <p className="text-muted-foreground">
                Authentication is not configured on this server.
              </p>
            ) : state.status === "anonymous" ? (
              <p className="text-muted-foreground">Not signed in.</p>
            ) : (
              <p>{state.user.email}</p>
            )}
            <div className="flex items-center gap-4">
              <Button type="button" variant="outline" onClick={() => void handleSignOut()}>
                Sign out
              </Button>
              {PERSONAL_URL && (
                <a
                  href={PERSONAL_URL}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Go to LaVega Personal
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/** Consent and the sector-inference setting are each their own tenant
 *  preference (Task 10); this section reads both so the switch can disable
 *  itself and explain why instead of saving an enable the server would
 *  reject 428 the next time inference actually runs. */
function DataSection() {
  const [consentAccepted, setConsentAccepted] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  /* Defaults to available: a server that omits the field (an older cached
   * response, a test double) should not read as "misconfigured". Only an
   * explicit `available: false` — no classifier configured on this
   * deployment — disables the switch. */
  const [available, setAvailable] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    void fetch("/api/market-data/consent")
      .then((response) => (response.ok ? response.json() : { accepted: false }))
      .then((body: { accepted?: unknown }) => {
        if (current) setConsentAccepted(body.accepted === true);
      })
      .catch(() => current && setConsentAccepted(false));
    void fetch("/api/investing/sector-inference")
      .then((response) => (response.ok ? response.json() : { enabled: false, available: true }))
      .then((body: { enabled?: unknown; available?: unknown }) => {
        if (!current) return;
        setEnabled(body.enabled === true);
        setAvailable(body.available !== false);
      })
      .catch(() => {
        if (!current) return;
        setEnabled(false);
        setAvailable(true);
      });
    return () => {
      current = false;
    };
  }, []);

  const disabled = saving || enabled === null || consentAccepted !== true || !available;

  async function toggle() {
    if (enabled === null || disabled) return;
    const next = !enabled;
    setSaving(true);
    try {
      const response = await fetch("/api/investing/sector-inference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (response.ok) {
        const body: { enabled?: unknown } = await response.json().catch(() => ({}));
        setEnabled(body.enabled === true ? true : body.enabled === false ? false : next);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="data" aria-label="Data">
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold">Sector inference</p>
              <p className="text-sm text-muted-foreground">
                Sends each holding's ticker and name, never quantities or values, to an AI model to
                classify positions with no sector data. Needs market-data consent.
              </p>
              {!available ? (
                <p className="mt-1 text-xs text-warning">
                  Sector inference is not available on this server.
                </p>
              ) : (
                consentAccepted === false && (
                  <p className="mt-1 text-xs text-warning">
                    Grant market-data consent from Overview before turning this on.
                  </p>
                )
              )}
            </div>
            <Switch
              on={enabled === true}
              disabled={disabled}
              label="Sector inference"
              onToggle={() => void toggle()}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

type StatusTone = "neutral" | "active" | "success" | "warning" | "problem";

function StatusChip({
  label,
  value,
  detail,
  tone = "neutral",
  children,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: StatusTone;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "problem"
      ? "border-negative/30 bg-negative/5"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10"
        : tone === "success"
          ? "border-positive/30 bg-positive/5"
          : tone === "active"
            ? "border-primary/20 bg-secondary/40"
            : "border-border bg-secondary/20";
  const dotClass =
    tone === "problem"
      ? "bg-negative"
      : tone === "warning"
        ? "bg-warning"
        : tone === "success"
          ? "bg-positive"
          : tone === "active"
            ? "bg-primary"
            : "bg-muted-foreground";
  return (
    <div className={`rounded-tile border px-3 py-2.5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClass}`} />
          {label}
        </span>
        <span className="text-xs font-semibold">{value}</span>
      </div>
      {detail && <p className="mt-1 truncate pl-4 text-2xs text-muted-foreground">{detail}</p>}
      {children}
    </div>
  );
}

function ClearPriceCache() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/prices/cache", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to clear");
      setMessage("Price data deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to clear");
    } finally {
      setBusy(false);
    }
  }
  if (confirming)
    return (
      <div className="flex flex-wrap items-center justify-end gap-3" role="alert">
        <span className="text-xs text-negative">This deletes all locally stored price data.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={clear} disabled={busy}>
          {busy ? "Clearing…" : "Yes, delete everything"}
        </Button>
      </div>
    );
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        Clear price data
      </Button>
      {message && (
        <span role="status" className="text-xs text-muted-foreground">
          {message}
        </span>
      )}
    </div>
  );
}

function StatusSection() {
  const state = useDashboard();
  const { broker, price, priceProblem, vault, connection } = useSyncSession();
  const dataVersion = state.status === "ready" ? state.data.dataVersion : 0;
  const brokerValue =
    broker?.status === "running"
      ? "In progress"
      : broker?.status === "waiting"
        ? "Waiting"
        : broker?.status === "completed"
          ? "Up to date"
          : broker?.status === "problem"
            ? "Problem"
            : broker?.status === "idle"
              ? "Ready"
              : "Unknown";
  const priceValue = priceProblem
    ? "Incomplete"
    : price?.status === "running" || price?.status === "paused"
      ? `${price.completed} of ${price.total} loaded`
      : price?.status === "waiting"
        ? "Waiting"
        : price?.status === "completed"
          ? "Up to date"
          : price?.status === "problem"
            ? "Problem"
            : price?.status === "idle"
              ? "Ready"
              : "Unknown";
  const statusTone = (
    status?: BrokerProgress["status"] | PriceSyncProgress["status"],
  ): StatusTone =>
    status === "problem"
      ? "problem"
      : status === "waiting"
        ? "warning"
        : status === "running" || status === "paused"
          ? "active"
          : status === "completed"
            ? "success"
            : "neutral";
  return (
    <section id="status" aria-label="Status">
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" aria-live="polite">
            {connection !== "online" && (
              <StatusChip
                label="Connection"
                value={connection === "retrying" ? "Reconnecting" : "Offline"}
                tone={connection === "retrying" ? "warning" : "problem"}
                detail={
                  connection === "retrying"
                    ? "Sync continues; status checks retry"
                    : "Status could not be read"
                }
              />
            )}
            <StatusChip
              label="Brokers"
              value={brokerValue}
              tone={statusTone(broker?.status)}
              detail={
                broker?.status === "waiting"
                  ? (broker.message ?? "Waiting for API capacity")
                  : broker?.status === "problem"
                    ? (broker.message ?? "Cached data remains visible")
                    : undefined
              }
            />
            <StatusChip
              label="Price history"
              value={priceValue}
              tone={priceProblem ? "problem" : statusTone(price?.status)}
              detail={
                priceProblem
                  ? priceProblem
                  : price?.status === "running" || price?.status === "paused"
                    ? price.currentSymbol
                      ? `${price.currentSymbol} is loading`
                      : `${price.remainingSymbols.length} symbols remaining`
                    : price?.status === "problem"
                      ? `${price.problems.length} symbol problems; cache remains available`
                      : undefined
              }
            />
            <StatusChip
              label="Vault"
              value={
                vault === "unlocked"
                  ? "Open"
                  : vault === "locked"
                    ? "Locked"
                    : vault === "empty"
                      ? "Not set up"
                      : "Unknown"
              }
              tone={vault === "unlocked" ? "success" : vault === "locked" ? "warning" : "neutral"}
            />
            <StatusChip
              label="Cache"
              value={state.status === "ready" ? `Version ${dataVersion}` : "Loading…"}
              tone={state.status === "ready" && dataVersion > 0 ? "success" : "neutral"}
            >
              <div className="mt-2 flex justify-end">
                <ClearPriceCache />
              </div>
            </StatusChip>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export function Profile() {
  const layout = useInvestingLayout();

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className="space-y-6">
      <section id="brokers" aria-label="Brokers">
        <Card>
          <CardHeader>
            <CardTitle>Brokers</CardTitle>
          </CardHeader>
          <CardContent>
            <BrokerSettings />
          </CardContent>
        </Card>
      </section>

      <section id="modules" aria-label="Modules">
        <Card>
          <CardHeader>
            <CardTitle>Modules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Choose which tabs appear in the top bar.
            </p>
            <LayoutPicker
              kind="module"
              enabled={layout.modules}
              disabled={layout.status === "loading"}
              onChange={(id, on) => layout.setModules({ [id]: on })}
            />
            {layout.saveError && (
              <p role="alert" className="mt-3 text-sm text-negative">
                {layout.saveError}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section id="widgets" aria-label="Widgets">
        <Card>
          <CardHeader>
            <CardTitle>Widgets</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Choose which cards appear on Overview.
            </p>
            <LayoutPicker
              kind="widget"
              enabled={layout.widgets}
              disabled={layout.status === "loading"}
              onChange={(id, on) => layout.setWidgets({ [id]: on })}
            />
            {layout.saveError && (
              <p role="alert" className="mt-3 text-sm text-negative">
                {layout.saveError}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <StatusSection />

      <DataSection />

      <AccountSection />
    </div>
  );
}
