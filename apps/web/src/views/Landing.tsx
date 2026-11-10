import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
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
import { RESET_PASSWORD_PATH, useAuthState } from "../authClient.js";
import { NewPasswordForm, RequestResetForm } from "../components/PasswordResetForms.js";
import { shellCopy } from "../copy/shell.js";
import SignInForm from "../components/SignInForm.js";
import SignUpForm from "../components/SignUpForm.js";
import Conversation from "./landing/Conversation.js";
import RevealWords from "./landing/RevealWords.js";
import ThreeBoxes from "./landing/ThreeBoxes.js";
import { useAnimated, useReducedMotion } from "./landing/motion.js";

type AuthView = "sign-in" | "sign-up" | "forgot" | "new-password";

const CONTACT_EMAIL = "alexander.steunenberg@gmail.com";
const SECTION_IDS = ["does", "faq"] as const;
const delay = (n: number) => ({ "--d": n }) as CSSProperties;

/** The emailed reset link lands on /reset-password?token=… (or ?error=… when
 *  better-auth already refused the token). Read once, then strip the token
 *  from the address bar so it does not sit in history or a shared screenshot. */
let resetLinkTaken: { token: string | null } | null | undefined;
function takeResetLink(): { token: string | null } | null {
  if (resetLinkTaken !== undefined) return resetLinkTaken;
  if (typeof window === "undefined" || window.location.pathname !== RESET_PASSWORD_PATH)
    return null;
  const params = new URLSearchParams(window.location.search);
  resetLinkTaken = { token: params.has("error") ? null : params.get("token") };
  window.history.replaceState({}, "", "/");
  return resetLinkTaken;
}

/** Heading with its last words in italics. */
function Heading({ lead, em }: { lead: string; em: string }) {
  return (
    <>
      {lead} <em>{em}</em>
    </>
  );
}

/** Public marketing landing page: midnight palette, Libron, the
 *  gradient only in the hero and the closing call to action. Every "get early
 *  access" button opens the auth dialog on its sign-up view; "Log in" opens it
 *  on sign-in and enters the vault (`/app`) via `onEnter`. */
export default function Landing({
  onEnter,
  locale = DEFAULT_LOCALE,
  linkError = false,
}: {
  onEnter: () => void;
  locale?: Locale;
  /** The visitor followed an invalid or expired confirmation link. */
  linkError?: boolean;
}) {
  const c = landingCopy(locale);
  const { state: authState } = useAuthState();
  const reduce = useReducedMotion();
  const animated = useAnimated();
  const [resetLink] = useState(takeResetLink);
  const [showSignIn, setShowSignIn] = useState(linkError || resetLink !== null);
  const [authView, setAuthView] = useState<AuthView>(resetLink ? "new-password" : "sign-in");
  /* Carries the typed address from sign-in into "forgot password" and back,
   * and the "password changed" line onto the sign-in form after a reset. */
  const [resetEmail, setResetEmail] = useState("");
  const [signInNotice, setSignInNotice] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const account = shellCopy[locale].profiel.account;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /* Whichever button opened the dialog gets the focus back when it closes. */
  const openerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
      dialog.querySelector<HTMLInputElement>("input")?.focus();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
      (openerRef.current ?? triggerRef.current)?.focus();
    }
  }, [showSignIn, authState.kind]);

  function openSignUp() {
    if (authState.kind === "signed-in") {
      onEnter();
      return;
    }
    setAuthView("sign-up");
    setShowSignIn(true);
  }

  function openSignIn() {
    if (authState.kind === "signed-in") {
      onEnter();
      return;
    }
    if (showSignIn && authView === "sign-in") {
      setShowSignIn(false);
      return;
    }
    setAuthView("sign-in");
    setShowSignIn(true);
  }

  const withOpener = (open: () => void) => (e: MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
    open();
  };
  const onCta = withOpener(openSignUp);
  const onLogin = withOpener(openSignIn);

  /* `<html lang>` has to follow the copy, and the two pages have to declare
   * each other as alternates — otherwise the English page reads to a search
   * engine as content competing with the Dutch one it exists alongside. Title
   * and meta description are restored on unmount so entering the vault via
   * "Log in" leaves the plain "LaVega" title behind instead of leaking the
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

  /* The open mobile menu locks page scroll, makes everything behind it inert,
   * moves focus into the panel, and closes on Escape or when the viewport grows
   * past the mobile breakpoint (the burger is gone there, so nothing could close
   * it). Focus goes back to the burger on close. Declared before the
   * window-scroll effect below: on unmount cleanups run in order, so this one
   * restores first and that one has the last word on body.overflow. */
  useEffect(() => {
    if (!menuOpen) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const dialog = dialogRef.current;
    const burger = burgerRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const behind = [...(root?.children ?? [])].filter(
      (el) => el !== panel && !el.matches("nav, dialog") && !el.hasAttribute("inert"),
    );
    behind.forEach((el) => el.setAttribute("inert", ""));
    panel?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const wide =
      typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 761px)") : null;
    const onWide = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    wide?.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = prevOverflow;
      behind.forEach((el) => el.removeAttribute("inert"));
      window.removeEventListener("keydown", onKey);
      wide?.removeEventListener("change", onWide);
      if (!dialog?.open) burger?.focus();
    };
  }, [menuOpen]);

  // Let the whole window scroll (the app frame otherwise pins body overflow).
  // Restored on unmount so the dashboard frame behaves again.
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

  // Scroll-reveal (fade/rise) via IntersectionObserver. Without one, show everything.
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll<HTMLElement>(".r");
    if (!els) return;
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("in-view"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Scrollspy: the nav link of the section crossing the middle of the screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiveSection(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    SECTION_IDS.forEach((id) => {
      const el = root.querySelector(`#${id}`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  const otherLocale = locale === "en" ? "nl" : "en";
  const closeMenu = () => setMenuOpen(false);
  const switchLocale = () => rememberLocale(otherLocale);
  const shot = c.hero.shot;

  return (
    <div className="lp" ref={rootRef}>
      <a className="skip" href="#main">
        {c.skip}
      </a>
      <nav className="lp-nav" aria-label={c.nav.label}>
        <div className="w">
          <a className="logo" href="#main">
            LaVega
          </a>
          <div className="links">
            <a href="#does" aria-current={activeSection === "does" ? "true" : undefined}>
              {c.nav.how}
            </a>
            <a href="#faq" aria-current={activeSection === "faq" ? "true" : undefined}>
              {c.nav.faq}
            </a>
            <a
              className="lp-lang"
              href={alternatePath(locale)}
              hrefLang={otherLocale}
              title={c.langSwitch.to}
              aria-label={c.langSwitch.to}
              onClick={switchLocale}
            >
              {c.langSwitch.label}
            </a>
          </div>
          <div className="right">
            <button ref={triggerRef} type="button" className="login" onClick={onLogin}>
              {c.nav.login}
            </button>
            <button type="button" className="btn small" onClick={onCta}>
              {c.nav.cta}
            </button>
            <button
              ref={burgerRef}
              type="button"
              className="burger"
              aria-expanded={menuOpen}
              aria-controls="panel"
              aria-label={c.nav.menu}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <i />
              <i />
            </button>
          </div>
        </div>
      </nav>
      <div className={`panel${menuOpen ? " open" : ""}`} id="panel" ref={panelRef}>
        <a style={{ "--n": 0 } as CSSProperties} href="#does" onClick={closeMenu}>
          {c.nav.how}
        </a>
        <a style={{ "--n": 1 } as CSSProperties} href="#faq" onClick={closeMenu}>
          {c.nav.faq}
        </a>
        <button
          type="button"
          style={{ "--n": 2 } as CSSProperties}
          onClick={(e) => {
            closeMenu();
            onLogin(e);
            /* The panel is hidden once closed; the burger is what the visitor can see. */
            openerRef.current = burgerRef.current;
          }}
        >
          {c.nav.login}
        </button>
        <a
          style={{ "--n": 3 } as CSSProperties}
          className="lp-lang-menu"
          href={alternatePath(locale)}
          hrefLang={otherLocale}
          onClick={() => {
            closeMenu();
            switchLocale();
          }}
        >
          {c.nav.menuLanguage}
        </a>
      </div>

      <dialog
        ref={dialogRef}
        className="lp-signin-dialog"
        aria-labelledby="lp-dialog-title"
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
        <h2 id="lp-dialog-title">
          {authView === "sign-up"
            ? c.login.signUpTitle
            : authView === "forgot"
              ? account.reset.requestTitle
              : authView === "new-password"
                ? account.reset.newTitle
                : c.nav.login}
        </h2>
        {linkError && authView === "sign-in" && <p role="alert">{c.login.linkInvalid}</p>}
        {authView === "forgot" ? (
          <RequestResetForm
            locale={locale}
            initialEmail={resetEmail}
            onBack={() => setAuthView("sign-in")}
          />
        ) : authView === "new-password" ? (
          <NewPasswordForm
            locale={locale}
            token={resetLink?.token ?? null}
            onDone={() => {
              setSignInNotice(account.reset.done);
              setAuthView("sign-in");
            }}
            onRequestNew={() => setAuthView("forgot")}
          />
        ) : authView === "sign-up" ? (
          <SignUpForm locale={locale} intro={c.login.signUpIntro} />
        ) : (
          <SignInForm
            locale={locale}
            intro={c.login.intro}
            notice={signInNotice}
            initialEmail={resetEmail}
            onForgotPassword={(email) => {
              setResetEmail(email);
              setSignInNotice(undefined);
              setAuthView("forgot");
            }}
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
        )}
        {(authView === "sign-in" || authView === "sign-up") && (
          <button
            type="button"
            data-testid="auth-toggle"
            className="lp-dialog-link"
            onClick={() => setAuthView((v) => (v === "sign-in" ? "sign-up" : "sign-in"))}
          >
            {authView === "sign-up" ? c.login.toSignIn : c.login.toSignUp}
          </button>
        )}
      </dialog>

      <header className="g g-hero hero">
        <div className="w">
          <p className="kicker">{c.hero.eyebrow}</p>
          <h1>
            {c.hero.lineOne}
            <br />
            {c.hero.lineTwo} <em>{c.hero.em}</em>
          </h1>
          <p className="sub">{c.hero.sub}</p>
          <button type="button" className="btn" onClick={onCta}>
            {c.nav.cta}
          </button>
          <div className="shot" role="img" aria-label={shot.label}>
            <div className="shot-nav">
              <b>LaVega</b>
              {shot.tabs.map((tab, i) => (
                <span key={tab} className={i === 1 ? "on" : i > 1 ? "x" : undefined}>
                  {tab}
                </span>
              ))}
            </div>
            <div className="shot-main">
              <h2>{shot.title}</h2>
              <p>{shot.asOf}</p>
              <p className="shot-mut">{shot.source}</p>
              <p className="shot-links">
                <span>{shot.links[0]}</span>
                <span>{shot.links[1]}</span>
              </p>
              {shot.cards.map((card) => (
                <div className="shot-card" key={card.title}>
                  <strong>{card.title}</strong>
                  <span>
                    {card.value}
                    <i className={card.attention ? "warn" : undefined}>
                      {card.attention ? shot.warn : shot.ok}
                    </i>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section>
          <div className="w">
            <h2 className="r">
              <Heading {...c.view.title} />
            </h2>
            <p className="lead r" style={delay(1)}>
              {c.view.lead}
            </p>
          </div>
        </section>

        <section className="flush">
          <div className="w problem">
            <div className="r">
              <h2>
                <Heading {...c.problem.title} />
              </h2>
            </div>
            <div className="r" style={delay(1)}>
              <div className="stat">{c.problem.stat}</div>
              <p className="statnote">{c.problem.note}</p>
            </div>
          </div>
        </section>

        <section className="flush">
          <div className="w">
            <RevealWords text={c.reveal} reduce={reduce} />
          </div>
        </section>

        <section id="does" className="flush">
          <div className="w">
            <h2 className="r">
              <Heading {...c.does.title} />
            </h2>
            <ThreeBoxes copy={c.does} animated={animated} reduce={reduce} />
          </div>
        </section>

        <section className="flush">
          <div className="w r">
            <blockquote>
              {c.quote.text}
              <cite>{c.quote.cite}</cite>
            </blockquote>
          </div>
        </section>

        <section className="flush">
          <div className="w">
            <Conversation copy={c.acts} animated={animated} />
          </div>
        </section>

        <section id="faq" className="flush">
          <div className="w split">
            <h2 className="r">
              <Heading {...c.faq.title} />
            </h2>
            <div className="faq r">
              {c.faq.items.map((item, i) => (
                <details key={item.q} open={i === 0 ? true : undefined}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <div className="g g-end end">
        <div className="w">
          <h2 className="r">
            <Heading {...c.end.title} />
          </h2>
          <button type="button" className="btn r" style={delay(2)} onClick={onCta}>
            {c.nav.cta}
          </button>
        </div>
      </div>
      <footer>
        <div className="w foot">
          <span>{c.footer.note}</span>
          <span>
            <a href="/privacy">{c.footer.privacy}</a> · <a href="/terms">{c.footer.terms}</a> ·{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{c.footer.contact}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
