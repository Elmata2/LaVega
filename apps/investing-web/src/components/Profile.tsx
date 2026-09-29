import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, signOut, type SessionState } from "../lib/auth-client.js";
import { useInvestingLayout } from "../lib/layoutResource.js";
import { PERSONAL_URL } from "../lib/personal.js";
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
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((body: { enabled?: unknown }) => {
        if (current) setEnabled(body.enabled === true);
      })
      .catch(() => current && setEnabled(false));
    return () => {
      current = false;
    };
  }, []);

  const disabled = saving || enabled === null || consentAccepted !== true;

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
                Sends each holding's ticker and name, never quantities or values, to an AI model
                to classify positions with no sector data. Needs market-data consent.
              </p>
              {consentAccepted === false && (
                <p className="mt-1 text-xs text-warning">
                  Grant market-data consent from Overview before turning this on.
                </p>
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

      <DataSection />

      <AccountSection />
    </div>
  );
}
