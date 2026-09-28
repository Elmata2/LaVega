import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, signOut, type SessionState } from "../lib/auth-client.js";
import { useInvestingLayout } from "../lib/layoutResource.js";
import { PERSONAL_URL } from "../lib/personal.js";
import { BrokerSettings } from "./BrokerSettings.js";
import { LayoutPicker } from "./LayoutPicker.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import type { InvestingModuleId, InvestingWidgetId } from "@lavega/core";

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
              onChange={(next: InvestingModuleId[]) => {
                const record: Partial<Record<InvestingModuleId, boolean>> = {};
                for (const id of ["positions", "net-worth", "agents"] as const)
                  record[id] = next.includes(id);
                layout.setModules(record);
              }}
            />
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
              onChange={(next: InvestingWidgetId[]) => {
                const record: Partial<Record<InvestingWidgetId, boolean>> = {};
                for (const id of [
                  "performance",
                  "allocation",
                  "kpis",
                  "risk",
                  "sectors",
                  "agent",
                ] as const)
                  record[id] = next.includes(id);
                layout.setWidgets(record);
              }}
            />
          </CardContent>
        </Card>
      </section>

      <AccountSection />
    </div>
  );
}
