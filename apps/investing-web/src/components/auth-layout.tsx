import type { ReactNode } from "react";

/* The public site root. Absolute on purpose: investing-web is mounted at
 * /investing/ on lavega.dev but served at / standalone, so a relative "/" would
 * either leave the app (lavega.dev) or stay inside it (standalone). */
export const PUBLIC_SITE_URL = "https://www.lavega.dev/";

export const AUTH_PROMISE = "A read-only view of your brokers. LaVega never trades or moves money.";

/* Same meaning as the public FAQ "Is my data safe?" (apps/web landingCopy.ts):
 * do not soften or strengthen it. */
export const AUTH_HONESTY =
  "Your data is encrypted. We hold the keys, so technically we can access your data. Broker connections are read only.";

export function AuthHonestyLine() {
  return (
    <p className="text-center text-xs leading-relaxed text-muted-foreground">{AUTH_HONESTY}</p>
  );
}

/* Context above the form: wordmark, headline and the read-only promise. Wide
 * screens put it beside the card; phones stack it so the form stays near the
 * top. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-fade mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-5 py-8 lg:max-w-5xl lg:flex-row lg:items-center lg:gap-20 lg:py-10">
      <div className="flex flex-col gap-5 lg:flex-1 lg:gap-8">
        <div className="flex items-baseline justify-between gap-3 lg:justify-start lg:gap-3">
          <span className="font-display text-3xl">LaVega</span>
          <span className="text-sm text-muted-foreground">Investing</span>
        </div>
        <div className="space-y-3">
          <p className="font-display text-4xl text-balance lg:text-6xl">
            Every broker. One honest view.
          </p>
          <p className="max-w-[38ch] text-base text-muted-foreground">{AUTH_PROMISE}</p>
        </div>
        <a
          href={PUBLIC_SITE_URL}
          className="hidden w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:inline"
        >
          ← lavega.dev
        </a>
      </div>
      <div className="flex w-full flex-col gap-5 lg:max-w-md lg:flex-none">
        {children}
        <a
          href={PUBLIC_SITE_URL}
          className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:hidden"
        >
          ← lavega.dev
        </a>
      </div>
    </main>
  );
}
