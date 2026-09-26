import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import CardSpiral from "./CardSpiral";
import { INVESTING_URL } from "../investing.js";
import { landingCopy } from "../landingCopy.js";
import {
  alternatePath,
  applyDocumentLocale,
  applyHreflang,
  DEFAULT_LOCALE,
  rememberLocale,
  type Locale,
} from "../locale.js";
import { APP_BASE } from "../appRoutes.js";
import { useAuthState } from "../authClient.js";
import SignInForm from "../components/SignInForm.js";

/** Deployed Google Apps Script web-app URL (…/exec) that appends waitlist rows
 *  to the "LaVega — Wachtlijst" Google Sheet. Empty until deployed → the form
 *  shows a "binnenkort" state instead of silently dropping sign-ups. */
const WAITLIST_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxouQ-TkXgdAipOfHJS9A-ChGqthOjDDxjngh8ytmiP2OOU4sbKVEB7CscuQz1QKcvT/exec";

/** Bots fill and submit forms faster than a human can read them. A submit
 *  before this much time has passed since mount is held (the button shows
 *  "sending") until the window closes, then posted; a real visitor with
 *  autofill loses nothing, a bot has to wait like everyone else. */
const WAITLIST_MIN_FILL_MS = 2000;

/* The hero/waitlist/footer CTAs used to share `.lp-btn`/`.lp-btn-dark` (still
 * used by the nav login button and the strengths-tile CTA, both outside this
 * pass) with a `.lp-btn-lg` size modifier layered on top. Mixing that
 * unlayered class with a Tailwind padding override would lose to it — see the
 * `@layer components` note in landing.css — so these four buttons are now
 * fully Tailwind, duplicating `.lp-btn`'s shape rather than reaching for it.
 *
 * One of the four is a `<button>`, and base.css's bare `button{}` (background,
 * border, border-radius, padding, color, font-size, cursor — all unlayered)
 * would beat every one of those Tailwind utilities under the cascade-layers
 * rule regardless of specificity. `!` forces each to win; on the three `<a>`
 * CTAs it is a harmless no-op except for color, where base.css's bare `a`
 * rule has the same problem. */
const LP_BTN =
  "inline-flex items-center gap-2 rounded-pill! font-body! text-[0.95rem]! font-semibold border! " +
  "cursor-pointer! no-underline whitespace-nowrap transition-[transform,box-shadow,background] " +
  "duration-[120ms] ease-[ease] motion-safe:hover:-translate-y-px";
const LP_BTN_LG = "px-[28px]! py-[15px]! text-[1.02rem]!";
/** `.lp-btn`'s own (non-`-lg`) padding — the nav "Inloggen" button and the
 *  strengths-tile CTA, converted from `.lp-btn`/`.lp-btn-dark` below. */
const LP_BTN_MD = "px-[22px]! py-[11px]!";
const LP_BTN_DARK =
  "bg-[var(--lp-ink)]! text-[var(--lp-cream)]! border-transparent! shadow-[0_12px_26px_-14px_rgba(43,33,23,.6)]";
const LP_BTN_LIGHT = "bg-[var(--lp-card)]! text-[var(--lp-ink)]! border-[var(--lp-line)]!";
const LP_BTN_TAN =
  "bg-[var(--lp-tan)]! text-[var(--lp-espresso)]! border-transparent! shadow-[0_14px_30px_-14px_rgba(176,127,51,.7)]";

/** Public marketing landing page. Warm-cream + espresso + tan, big EB Garamond
 *  serif (StrategiQ-inspired), broad audience (students → werkenden →
 *  ondernemers). The app isn't public yet — it's a waitlist front door: the
 *  prominent CTAs go to #wachtlijst; only the discreet header "Inloggen" enters
 *  the vault (`/app`) via `onEnter`, for owner/Railway testing. */
export default function Landing({
  onEnter,
  locale = DEFAULT_LOCALE,
}: {
  onEnter: () => void;
  locale?: Locale;
}) {
  const c = landingCopy(locale);
  const { state: authState } = useAuthState();
  const [showSignIn, setShowSignIn] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /* The dialog is always mounted; only showModal()/close() move it on/off
   * screen. That's what gives the CSS exit transition something to animate
   * (an unmount has nothing left to fade), and it's why a failed sign-in
   * never wipes the typed email — the form stays alive underneath.
   *
   * `showSignIn` is the only thing that opens or closes it. The obvious
   * alternative, syncing state back from the dialog's `close` event, does not
   * work: measured in Chrome on the built page, showModal() and close() both
   * work and the `close` event never fires at all, which left the trigger
   * needing two clicks to reopen and focus stranded inside a hidden dialog. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const shouldOpen = showSignIn && authState.kind !== "signed-in";
    if (shouldOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>("#account-email")?.focus();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
      triggerRef.current?.focus();
    }
  }, [showSignIn, authState.kind]);

  /* `<html lang>` has to follow the copy, and the two pages have to declare
   * each other as alternates — otherwise the English page reads to a search
   * engine as content competing with the Dutch one it exists alongside. Title
   * and meta description are restored on unmount so entering the vault via
   * "Inloggen" leaves the plain "LaVega" title behind instead of leaking the
   * public pitch into the app frame. */
  useEffect(() => {
    const prev = {
      title: document.title,
      metaDescription:
        document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    };
    applyDocumentLocale(locale);
    applyHreflang(window.location.origin);
    return () => {
      document.title = prev.title;
      const meta = document.querySelector('meta[name="description"]');
      if (prev.metaDescription === null) meta?.remove();
      else meta?.setAttribute("content", prev.metaDescription);
    };
  }, [locale]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const agentsRef = useRef<HTMLDivElement | null>(null);

  function scrollAgents(dir: 1 | -1) {
    const track = agentsRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".lp-feature-card");
    const step = card ? card.offsetWidth + 20 : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  // Waitlist form → Google Sheet (via the Apps Script web app). Fire-and-forget
  // no-cors POST (Apps Script can't do CORS preflight), so we optimistically
  // confirm on a resolved fetch and only show an error on a network failure.
  const wlReady = WAITLIST_ENDPOINT.length > 0;
  const [wlName, setWlName] = useState("");
  const [wlEmail, setWlEmail] = useState("");
  const [wlHoneypot, setWlHoneypot] = useState("");
  const [wlStatus, setWlStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const wlMountedAt = useRef<number | null>(null);
  useEffect(() => {
    wlMountedAt.current = Date.now();
  }, []);

  async function submitWaitlist(e: FormEvent) {
    e.preventDefault();
    const email = wlEmail.trim();
    if (!wlReady || !email || wlStatus === "sending") return;
    if (wlHoneypot.trim()) {
      // A bot filled the hidden field — pretend success without posting.
      setWlStatus("done");
      setWlName("");
      setWlEmail("");
      setWlHoneypot("");
      return;
    }
    setWlStatus("sending");
    const elapsed = wlMountedAt.current === null ? 0 : Date.now() - wlMountedAt.current;
    if (elapsed < WAITLIST_MIN_FILL_MS)
      await new Promise((resolve) => setTimeout(resolve, WAITLIST_MIN_FILL_MS - elapsed));
    try {
      await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        body: new URLSearchParams({ name: wlName.trim(), email, source: "lavega.dev" }),
      });
      setWlStatus("done");
      setWlName("");
      setWlEmail("");
      setWlHoneypot("");
    } catch {
      setWlStatus("error");
    }
  }

  // Let the whole window scroll (the app frame otherwise pins body overflow).
  // Restored on unmount so the dashboard frame behaves again. Window-scrolling
  // also lets GSAP ScrollTrigger track with its default scroller.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { htmlH: html.style.height, bodyH: body.style.height, bodyO: body.style.overflow };
    html.style.height = "auto";
    body.style.height = "auto";
    body.style.overflow = "visible";
    body.classList.add("lp-scroll");
    return () => {
      html.style.height = prev.htmlH;
      body.style.height = prev.bodyH;
      body.style.overflow = prev.bodyO;
      body.classList.remove("lp-scroll");
    };
  }, []);

  // Scroll-reveal (fade/rise) via IntersectionObserver; CSS keeps content
  // visible under prefers-reduced-motion.
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll<HTMLElement>(".lp-reveal");
    if (!els || !("IntersectionObserver" in window)) {
      els?.forEach((el) => el.classList.add("lp-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("lp-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const otherLocale = locale === "en" ? "nl" : "en";

  return (
    <div className="lp relative" ref={rootRef}>
      {/* Nav */}
      <header className="flex items-center justify-between gap-[var(--sp-4)] max-w-[1200px] mx-auto px-[28px] py-[22px]">
        <button
          type="button"
          className="font-display font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--lp-ink)] bg-transparent border-none border-[var(--lp-ink)] cursor-pointer p-0"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          LaVega
        </button>
        <nav className="flex gap-[28px] [@media(max-width:860px)]:hidden">
          <a
            className="text-[var(--lp-ink2)] no-underline text-[0.95rem] font-medium hover:text-[var(--lp-ink)]"
            href="#agents"
          >
            {c.nav.agents}
          </a>
          <a
            className="text-[var(--lp-ink2)] no-underline text-[0.95rem] font-medium hover:text-[var(--lp-ink)]"
            href="#privacy"
          >
            {c.nav.privacy}
          </a>
          <a
            className="text-[var(--lp-ink2)] no-underline text-[0.95rem] font-medium hover:text-[var(--lp-ink)]"
            href="#how"
          >
            {c.nav.how}
          </a>
          <a
            className="text-[var(--lp-ink2)] no-underline text-[0.95rem] font-medium hover:text-[var(--lp-ink)]"
            href="#wachtlijst"
          >
            {c.nav.waitlist}
          </a>
          {INVESTING_URL && (
            <a
              className="text-[var(--lp-ink2)] no-underline text-[0.95rem] font-medium hover:text-[var(--lp-ink)]"
              href={INVESTING_URL}
              {...(INVESTING_URL.startsWith("http")
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {c.nav.investing}
            </a>
          )}
        </nav>
        <a
          className="lp-lang text-[var(--lp-ink2)] no-underline text-[0.85rem] font-medium tracking-[0.02em] px-[10px] py-[6px] rounded-pill border border-[var(--lp-line)] mr-[10px] whitespace-nowrap [transition:color_140ms_ease,border-color_140ms_ease] hover:text-[var(--lp-ink)] hover:border-[var(--lp-ink2)] [@media(max-width:720px)]:hidden"
          href={alternatePath(locale)}
          hrefLang={otherLocale}
          title={c.langSwitch.to}
          onClick={() => rememberLocale(otherLocale)}
        >
          {c.langSwitch.label}
        </a>
        <button
          ref={triggerRef}
          type="button"
          className={`${LP_BTN} ${LP_BTN_MD} ${LP_BTN_DARK}`}
          onClick={() => {
            if (authState.kind === "signed-in") {
              onEnter();
              return;
            }
            setShowSignIn((shown) => !shown);
          }}
        >
          {c.nav.login}
        </button>
      </header>

      <dialog
        ref={dialogRef}
        className="lp-signin-dialog"
        aria-label={c.nav.login}
        onClick={(e) => {
          if (e.target === dialogRef.current) setShowSignIn(false);
        }}
        onCancel={(e) => {
          e.preventDefault();
          setShowSignIn(false);
        }}
      >
        <button
          type="button"
          className="lp-signin-dialog-close"
          aria-label={c.login.close}
          onClick={() => setShowSignIn(false)}
        >
          ×
        </button>
        <h2>{c.nav.login}</h2>
        <SignInForm
          locale={locale}
          intro={c.login.intro}
          introClassName="font-body text-[0.95rem] text-[var(--lp-ink2)]"
          onSuccess={() => {
            setShowSignIn(false);
            /* A full navigation, not onEnter()'s pushState. Root holds its own
             * useAuthState, fetched once at page load, and a client-side
             * transition leaves it reading "signed-out" — so Root's gate sent
             * the freshly signed-in user straight back to this landing page
             * while the URL said /app, and signing in looked like it did
             * nothing. Loading /app for real re-reads the session, and the
             * server gate sees the cookie that now exists. */
            window.location.assign(APP_BASE);
          }}
        />
      </dialog>

      {/* Hero */}
      <section className="lp-hero max-w-[1000px] mx-auto pt-[48px] px-[28px] pb-[40px] text-center">
        <h1 className="lp-reveal font-display! font-semibold! text-[clamp(2.6rem,6vw,4.6rem)]! leading-[1.04] tracking-[-0.02em]! m-0! mb-[22px]! text-[var(--lp-ink)]!">
          {c.hero.titleTop}
          <br />
          {c.hero.titleBottom}
        </h1>
        <p className="lp-reveal max-w-[640px] mx-auto! mt-0! mb-[28px]! text-[var(--lp-ink2)] text-[1.1rem]">
          {c.hero.sub}
        </p>
        <div className="lp-reveal flex gap-3 justify-center flex-wrap mb-[56px]">
          <a className={`${LP_BTN} ${LP_BTN_LG} ${LP_BTN_DARK}`} href="#wachtlijst">
            {c.hero.ctaPrimary} <span aria-hidden="true">→</span>
          </a>
          <a className={`${LP_BTN} ${LP_BTN_LG} ${LP_BTN_LIGHT}`} href="#how">
            {c.hero.ctaSecondary}
          </a>
        </div>

        {/* Floating product illustration */}
        <div className="lp-reveal relative max-w-[720px] min-h-[400px] mx-auto" aria-hidden="true">
          <div className="relative z-[2] w-[min(340px,82vw)] mx-auto bg-[var(--lp-card)] border border-[var(--lp-line)] rounded-[24px] p-[24px] text-left shadow-[0_40px_80px_-40px_rgba(43,33,23,.45),0_8px_20px_-12px_rgba(43,33,23,.2)]">
            <div className="font-mono text-[0.72rem] tracking-[0.04em] uppercase text-[var(--lp-ink2)]">
              {c.device.eyebrow}
            </div>
            <div className="text-[2.4rem] font-bold tracking-[-0.02em] tabular-nums mt-[2px]">
              €12.480
            </div>
            <div className="text-[var(--lp-pos)] text-[0.9rem] font-semibold mb-2">
              {c.device.delta}
            </div>
            <div className="mt-2 mb-[14px]">
              <svg viewBox="0 0 240 64" preserveAspectRatio="none" width="100%" height="64">
                <polyline
                  points="0,52 30,46 60,50 90,38 120,40 150,28 180,30 210,16 240,10"
                  fill="none"
                  stroke="var(--lp-tan-deep)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <div className="flex justify-between py-2 border-t border-[var(--lp-line)] text-[0.9rem] text-[var(--lp-ink2)]">
                <span>{c.device.rows[0]}</span>
                <span className="text-[var(--lp-ink)] font-semibold tabular-nums">28%</span>
              </div>
              <div className="flex justify-between py-2 border-t border-[var(--lp-line)] text-[0.9rem] text-[var(--lp-ink2)]">
                <span>{c.device.rows[1]}</span>
                <span className="text-[var(--lp-ink)] font-semibold tabular-nums">34%</span>
              </div>
              <div className="flex justify-between py-2 border-t border-[var(--lp-line)] text-[0.9rem] text-[var(--lp-ink2)]">
                <span>{c.device.rows[2]}</span>
                <span className="text-[var(--lp-ink)] font-semibold tabular-nums">18%</span>
              </div>
            </div>
          </div>
          <div className="absolute z-[3] bg-[var(--lp-card)] border border-[var(--lp-line)] rounded-[16px] px-4 py-3 shadow-[0_24px_50px_-28px_rgba(43,33,23,.4)] text-[0.9rem] top-[30px] left-0 [@media(max-width:560px)]:hidden motion-safe:animate-[lp-bob_4s_ease-in-out_infinite]">
            <div className="font-mono text-[0.68rem] tracking-[0.03em] uppercase text-[var(--lp-ink2)]">
              {c.device.savedLabel}
            </div>
            <div className="text-[1.15rem] font-bold tabular-nums text-[var(--lp-pos)] text-base">
              +€420
            </div>
          </div>
          <div className="absolute z-[3] bg-[var(--lp-card)] border border-[var(--lp-line)] rounded-[16px] px-4 py-3 shadow-[0_24px_50px_-28px_rgba(43,33,23,.4)] text-[0.9rem] top-[90px] right-0 [@media(max-width:560px)]:hidden motion-safe:animate-[lp-bob_5.5s_ease-in-out_infinite]">
            <div className="font-mono text-[0.68rem] tracking-[0.03em] uppercase text-[var(--lp-ink2)]">
              {c.device.forecastLabel}
            </div>
            <div className="text-[1.15rem] font-bold tabular-nums text-[var(--lp-pos)] text-base">
              {c.device.forecastValue}
            </div>
          </div>
          <div className="absolute z-[3] bg-[var(--lp-card)] border border-[var(--lp-line)] rounded-[16px] px-4 py-3 shadow-[0_24px_50px_-28px_rgba(43,33,23,.4)] text-[0.9rem] bottom-[24px] left-[8%] inline-flex items-center gap-2 font-semibold motion-safe:animate-[lp-bob_7s_ease-in-out_infinite]">
            <span className="text-base">🔒</span> {c.device.lockChip}
          </div>
        </div>
      </section>

      {/* Signature scroll section (GSAP card spiral + tagline) */}
      <CardSpiral locale={locale} />

      {/* Kern-tegels — waarom LaVega (SS1-inspired, our fonts + warm palet) */}
      <section className="lp-section lp-strengths" id="waarom">
        <div className="lp-strengths-head lp-reveal">
          <h2 className="lp-h2 lp-strengths-title">{c.strengths.title}</h2>
          <div className="lp-strengths-aside">
            <p className="lp-sub lp-strengths-sub">{c.strengths.sub}</p>
            <a className={`${LP_BTN} ${LP_BTN_MD} ${LP_BTN_DARK}`} href="#agents">
              {c.strengths.cta} <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <div className="lp-tiles lp-reveal">
          <article className="lp-tile">
            <h3 className="lp-tile-title">{c.strengths.tiles[0]}</h3>
            <div className="lp-ill lp-ill-fast" aria-hidden="true">
              <span className="c c1" />
              <span className="c c2" />
              <span className="c c3" />
              <span className="c c4" />
            </div>
          </article>
          <article className="lp-tile">
            <h3 className="lp-tile-title">{c.strengths.tiles[1]}</h3>
            <div className="lp-ill lp-ill-toggles" aria-hidden="true">
              <span className="tg" />
              <span className="tg on" />
              <span className="tg" />
            </div>
          </article>
          <article className="lp-tile">
            <h3 className="lp-tile-title">{c.strengths.tiles[2]}</h3>
            <div className="lp-ill lp-ill-rings" aria-hidden="true">
              <span className="lp-ring r1" />
              <span className="lp-ring r2" />
              <span className="orbit">
                <span className="odot" />
              </span>
              <span className="core" />
            </div>
          </article>
          <article className="lp-tile">
            <h3 className="lp-tile-title">{c.strengths.tiles[3]}</h3>
            <div className="lp-ill lp-ill-tree" aria-hidden="true">
              <svg viewBox="0 0 160 120" width="100%" height="120">
                <circle cx="80" cy="28" r="15" className="tree-node" />
                <circle cx="80" cy="28" r="5" className="tree-core" />
                <path d="M80,43 V66 M32,96 V80 H128 V96 M80,80 V96" className="tree-branch" />
                <circle cx="32" cy="100" r="4" className="tree-leaf" />
                <circle cx="80" cy="100" r="4" className="tree-leaf" />
                <circle cx="128" cy="100" r="4" className="tree-leaf" />
              </svg>
            </div>
          </article>
        </div>
      </section>

      {/* Agents — feature carousel (SS2-style, our fonts + warm palet) */}
      <section className="lp-section" id="agents">
        <div className="lp-carousel-head lp-reveal">
          <div>
            <p className="lp-eyebrow lp-eyebrow-left">{c.agents.eyebrow}</p>
            <h2 className="lp-h2 lp-strengths-title">{c.agents.title}</h2>
          </div>
          <div className="lp-carousel-nav">
            <button type="button" aria-label={c.agents.prev} onClick={() => scrollAgents(-1)}>
              ←
            </button>
            <button
              type="button"
              aria-label={c.agents.next}
              className="accent"
              onClick={() => scrollAgents(1)}
            >
              →
            </button>
          </div>
        </div>
        <div className="lp-carousel lp-reveal" ref={agentsRef}>
          {[
            {
              icon: (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 3h8l4 4v14H6z" />
                  <path d="M14 3v4h4" />
                  <path d="M9 13h6M9 17h6" />
                </svg>
              ),
              t: c.agents.cards[0]!.t,
              d: c.agents.cards[0]!.d,
            },
            {
              icon: (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              ),
              t: c.agents.cards[1]!.t,
              d: c.agents.cards[1]!.d,
            },
            {
              icon: (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 8h13M17 8l-3-3M17 8l-3 3" />
                  <path d="M20 16H7M7 16l3 3M7 16l3-3" />
                </svg>
              ),
              t: c.agents.cards[2]!.t,
              d: c.agents.cards[2]!.d,
            },
            {
              icon: (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6 6.9 19.2l1-5.7-4.1-4 5.7-.8z" />
                </svg>
              ),
              t: c.agents.cards[3]!.t,
              d: c.agents.cards[3]!.d,
            },
          ].map((a) => (
            <article className="lp-feature-card" key={a.t}>
              <div className="lp-feature-medallion" aria-hidden="true">
                {a.icon}
              </div>
              <h3 className="lp-feature-title">{a.t}</h3>
              <p className="lp-feature-text">{a.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section className="lp-section lp-privacy" id="privacy">
        <div className="lp-privacy-inner lp-reveal">
          <h2 className="lp-h2">{c.privacy.title}</h2>
          <p className="lp-sub">{c.privacy.sub}</p>
          <ul className="lp-ticks">
            {c.privacy.ticks.map((tick) => (
              <li key={tick}>{tick}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section" id="how">
        <p className="lp-eyebrow lp-reveal">{c.how.eyebrow}</p>
        <h2 className="lp-h2 lp-reveal">{c.how.title}</h2>
        <div className="lp-steps lp-reveal">
          {c.how.steps.map((step, i) => (
            <div className="lp-step" key={step.t}>
              <div className="lp-step-n">{i + 1}</div>
              <h3 className="lp-card-title">{step.t}</h3>
              <p className="lp-card-text">{step.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-[1100px] mx-auto py-[72px] px-[28px]" id="faq">
        <p className="lp-reveal font-mono text-[0.75rem] tracking-[0.08em] uppercase text-[var(--lp-tan-deep)] text-center m-0! mb-[10px]!">
          {c.faq.eyebrow}
        </p>
        <h2 className="lp-reveal font-display! font-semibold! text-[clamp(1.9rem,3.4vw,2.8rem)]! tracking-[-0.02em]! text-center m-0! mb-[36px]! text-[var(--lp-ink)]!">
          {c.faq.title}
        </h2>
        <div className="lp-reveal max-w-[760px] mx-auto flex flex-col gap-3">
          {c.faq.items.map((f) => (
            <details
              className="lp-faq-item bg-[var(--lp-card)] border border-[var(--lp-line)] rounded-[16px] px-[22px]"
              key={f.q}
            >
              <summary className="flex items-center justify-between gap-4 list-none cursor-pointer py-[18px] font-display font-semibold text-[1.1rem] text-[var(--lp-ink)]">
                <span>{f.q}</span>
                <span className="lp-faq-mark" aria-hidden="true" />
              </summary>
              <p className="m-0! mb-[18px]! text-[var(--lp-ink2)]">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Waitlist */}
      <section className="max-w-[1100px] mx-auto py-[72px] px-[28px]" id="wachtlijst">
        <div className="lp-reveal max-w-[680px] mx-auto text-center">
          <p className="font-mono text-[0.75rem] tracking-[0.08em] uppercase text-[var(--lp-tan-deep)] text-center m-0! mb-[10px]!">
            {c.waitlist.eyebrow}
          </p>
          <h2 className="font-display! font-semibold! text-[clamp(1.9rem,3.4vw,2.8rem)]! tracking-[-0.02em]! text-center m-0! mb-[36px]! text-[var(--lp-ink)]!">
            {c.waitlist.title}
          </h2>
          <p className="max-w-[640px] mx-auto! mt-0! mb-[28px]! text-[var(--lp-ink2)] text-[1.1rem]">
            {c.waitlist.sub}
          </p>
          {wlStatus === "done" ? (
            <p
              className="mt-[24px]! text-[1.1rem] text-[var(--lp-pos)] font-semibold"
              data-testid="waitlist-done"
            >
              {c.waitlist.done}
            </p>
          ) : (
            <form
              className="flex gap-[10px] justify-center flex-wrap mt-[24px]"
              onSubmit={submitWaitlist}
              data-testid="waitlist-form"
            >
              <input
                type="text"
                name="company"
                value={wlHoneypot}
                onChange={(e) => setWlHoneypot(e.target.value)}
                style={{ position: "absolute", left: "-9999px" }}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              <input
                type="text"
                className="flex-[1_1_220px] min-w-0 px-[18px]! py-[14px]! rounded-pill! border! border-[var(--lp-line)]! bg-[var(--lp-card)]! font-body! text-base! text-[var(--lp-ink)]! focus:outline-none! focus:border-[var(--lp-tan-deep)]! focus:shadow-[0_0_0_3px_rgba(207,159,94,.2)] disabled:opacity-60!"
                placeholder={c.waitlist.namePlaceholder}
                aria-label={c.waitlist.nameLabel}
                value={wlName}
                onChange={(e) => setWlName(e.target.value)}
                disabled={!wlReady || wlStatus === "sending"}
              />
              <input
                type="email"
                className="flex-[1_1_220px] min-w-0 px-[18px]! py-[14px]! rounded-pill! border! border-[var(--lp-line)]! bg-[var(--lp-card)]! font-body! text-base! text-[var(--lp-ink)]! focus:outline-none! focus:border-[var(--lp-tan-deep)]! focus:shadow-[0_0_0_3px_rgba(207,159,94,.2)] disabled:opacity-60!"
                placeholder={c.waitlist.emailPlaceholder}
                aria-label={c.waitlist.emailLabel}
                required
                value={wlEmail}
                onChange={(e) => setWlEmail(e.target.value)}
                disabled={!wlReady || wlStatus === "sending"}
              />
              <button
                type="submit"
                className={`${LP_BTN} ${LP_BTN_LG} ${LP_BTN_DARK} flex-none [@media(max-width:560px)]:flex-1 [@media(max-width:560px)]:justify-center disabled:opacity-60!`}
                disabled={!wlReady || wlStatus === "sending"}
              >
                {wlReady
                  ? wlStatus === "sending"
                    ? c.waitlist.sending
                    : c.waitlist.submit
                  : c.waitlist.soon}
              </button>
            </form>
          )}
          {!wlReady && (
            <p className="mt-3! text-[0.85rem] text-[var(--lp-ink2)]" data-testid="waitlist-note">
              {c.waitlist.notReady}
            </p>
          )}
          {wlStatus === "error" && (
            <p className="mt-3! text-[0.85rem] text-[var(--lp-ink2)]" data-testid="waitlist-note">
              {c.waitlist.error}
            </p>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[var(--lp-espresso)] text-[var(--lp-cream)] mt-[24px]">
        <div className="lp-reveal max-w-[1100px] mx-auto pt-[64px] px-[28px] pb-[40px] text-center">
          <h2 className="font-display! font-semibold! text-[clamp(1.9rem,3.4vw,2.8rem)]! tracking-[-0.02em]! text-center m-0! mb-[24px]! text-[var(--lp-cream)]!">
            {c.footer.ctaTitle}
          </h2>
          <a className={`${LP_BTN} ${LP_BTN_LG} ${LP_BTN_TAN}`} href="#wachtlijst">
            {c.footer.cta} <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="max-w-[1100px] mx-auto py-[32px] px-[28px] grid grid-cols-[1.6fr_1fr_1fr] gap-[32px] border-t border-[color-mix(in_srgb,var(--lp-cream)_12%,transparent)] [@media(max-width:860px)]:grid-cols-1 [@media(max-width:860px)]:gap-[24px]">
          <div>
            <div className="font-display font-semibold text-[1.4rem]">LaVega</div>
            <p className="text-[color-mix(in_srgb,var(--lp-cream)_70%,transparent)] text-[0.95rem] max-w-[320px] mt-[10px]!">
              {c.footer.note}
            </p>
          </div>
          <div className="flex flex-col gap-[10px]">
            <span className="font-mono text-[0.72rem] tracking-[0.06em] uppercase text-[color-mix(in_srgb,var(--lp-cream)_55%,transparent)] mb-1">
              {c.footer.product}
            </span>
            <a
              className="text-[color-mix(in_srgb,var(--lp-cream)_85%,transparent)]! no-underline text-[0.95rem] hover:text-[var(--lp-cream)]!"
              href="#agents"
            >
              {c.nav.agents}
            </a>
            <a
              className="text-[color-mix(in_srgb,var(--lp-cream)_85%,transparent)]! no-underline text-[0.95rem] hover:text-[var(--lp-cream)]!"
              href="#how"
            >
              {c.nav.how}
            </a>
            <a
              className="text-[color-mix(in_srgb,var(--lp-cream)_85%,transparent)]! no-underline text-[0.95rem] hover:text-[var(--lp-cream)]!"
              href="#faq"
            >
              {c.faq.eyebrow}
            </a>
          </div>
          <div className="flex flex-col gap-[10px]">
            <span className="font-mono text-[0.72rem] tracking-[0.06em] uppercase text-[color-mix(in_srgb,var(--lp-cream)_55%,transparent)] mb-1">
              {c.footer.legal}
            </span>
            <a
              className="text-[color-mix(in_srgb,var(--lp-cream)_85%,transparent)]! no-underline text-[0.95rem] hover:text-[var(--lp-cream)]!"
              href="/privacy"
            >
              {c.footer.privacy}
            </a>
            <a
              className="text-[color-mix(in_srgb,var(--lp-cream)_85%,transparent)]! no-underline text-[0.95rem] hover:text-[var(--lp-cream)]!"
              href="/terms"
            >
              {c.footer.terms}
            </a>
          </div>
        </div>
        <div className="max-w-[1100px] mx-auto pt-[20px] px-[28px] pb-[48px] text-[color-mix(in_srgb,var(--lp-cream)_50%,transparent)] text-[0.85rem]">
          {c.footer.rights}
        </div>
      </footer>
    </div>
  );
}
