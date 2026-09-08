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
    <div className="lp" ref={rootRef}>
      {/* Nav */}
      <header className="lp-nav">
        <button
          type="button"
          className="lp-brand"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          LaVega
        </button>
        <nav className="lp-nav-links">
          <a href="#agents">{c.nav.agents}</a>
          <a href="#privacy">{c.nav.privacy}</a>
          <a href="#how">{c.nav.how}</a>
          <a href="#wachtlijst">{c.nav.waitlist}</a>
          {INVESTING_URL && (
            <a
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
          className="lp-lang"
          href={alternatePath(locale)}
          hrefLang={otherLocale}
          title={c.langSwitch.to}
          onClick={() => rememberLocale(otherLocale)}
        >
          {c.langSwitch.label}
        </a>
        <button type="button" className="lp-btn lp-btn-dark" onClick={onEnter}>
          {c.nav.login}
        </button>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <h1 className="lp-h1 lp-reveal">
          {c.hero.titleTop}
          <br />
          {c.hero.titleBottom}
        </h1>
        <p className="lp-sub lp-reveal">{c.hero.sub}</p>
        <div className="lp-cta-row lp-reveal">
          <a className="lp-btn lp-btn-dark lp-btn-lg" href="#wachtlijst">
            {c.hero.ctaPrimary} <span aria-hidden="true">→</span>
          </a>
          <a className="lp-btn lp-btn-light lp-btn-lg" href="#how">
            {c.hero.ctaSecondary}
          </a>
        </div>

        {/* Floating product illustration */}
        <div className="lp-stage lp-reveal" aria-hidden="true">
          <div className="lp-device">
            <div className="lp-device-eyebrow">{c.device.eyebrow}</div>
            <div className="lp-device-value">€12.480</div>
            <div className="lp-device-delta">{c.device.delta}</div>
            <div className="lp-spark">
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
            <div className="lp-device-rows">
              <div>
                <span>{c.device.rows[0]}</span>
                <span>28%</span>
              </div>
              <div>
                <span>{c.device.rows[1]}</span>
                <span>34%</span>
              </div>
              <div>
                <span>{c.device.rows[2]}</span>
                <span>18%</span>
              </div>
            </div>
          </div>
          <div className="lp-chip lp-chip-a lp-float">
            <div className="lp-chip-label">{c.device.savedLabel}</div>
            <div className="lp-chip-value lp-pos">+€420</div>
          </div>
          <div className="lp-chip lp-chip-b lp-float lp-float-slow">
            <div className="lp-chip-label">{c.device.forecastLabel}</div>
            <div className="lp-chip-value lp-pos">{c.device.forecastValue}</div>
          </div>
          <div className="lp-chip lp-chip-c lp-float lp-float-slower">
            <span className="lp-lock">🔒</span> {c.device.lockChip}
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
            <a className="lp-btn lp-btn-dark" href="#agents">
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
              <span className="ring r1" />
              <span className="ring r2" />
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
      <section className="lp-section" id="faq">
        <p className="lp-eyebrow lp-reveal">{c.faq.eyebrow}</p>
        <h2 className="lp-h2 lp-reveal">{c.faq.title}</h2>
        <div className="lp-faq lp-reveal">
          {c.faq.items.map((f) => (
            <details className="lp-faq-item" key={f.q}>
              <summary>
                <span>{f.q}</span>
                <span className="lp-faq-mark" aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Waitlist */}
      <section className="lp-section lp-waitlist" id="wachtlijst">
        <div className="lp-waitlist-inner lp-reveal">
          <p className="lp-eyebrow">{c.waitlist.eyebrow}</p>
          <h2 className="lp-h2">{c.waitlist.title}</h2>
          <p className="lp-sub">{c.waitlist.sub}</p>
          {wlStatus === "done" ? (
            <p className="lp-waitlist-done">{c.waitlist.done}</p>
          ) : (
            <form className="lp-waitlist-form" onSubmit={submitWaitlist}>
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
                className="lp-input"
                placeholder={c.waitlist.namePlaceholder}
                aria-label={c.waitlist.nameLabel}
                value={wlName}
                onChange={(e) => setWlName(e.target.value)}
                disabled={!wlReady || wlStatus === "sending"}
              />
              <input
                type="email"
                className="lp-input"
                placeholder={c.waitlist.emailPlaceholder}
                aria-label={c.waitlist.emailLabel}
                required
                value={wlEmail}
                onChange={(e) => setWlEmail(e.target.value)}
                disabled={!wlReady || wlStatus === "sending"}
              />
              <button
                type="submit"
                className="lp-btn lp-btn-dark lp-btn-lg"
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
          {!wlReady && <p className="lp-waitlist-note">{c.waitlist.notReady}</p>}
          {wlStatus === "error" && <p className="lp-waitlist-note">{c.waitlist.error}</p>}
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer2">
        <div className="lp-footer2-cta lp-reveal">
          <h2 className="lp-h2">{c.footer.ctaTitle}</h2>
          <a className="lp-btn lp-btn-tan lp-btn-lg" href="#wachtlijst">
            {c.footer.cta} <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="lp-footer2-grid">
          <div className="lp-footer2-about">
            <div className="lp-footer2-brand">LaVega</div>
            <p className="lp-footer2-note">{c.footer.note}</p>
          </div>
          <div className="lp-footer2-col">
            <span className="lp-footer2-h">{c.footer.product}</span>
            <a href="#agents">{c.nav.agents}</a>
            <a href="#how">{c.nav.how}</a>
            <a href="#faq">{c.faq.eyebrow}</a>
          </div>
          <div className="lp-footer2-col">
            <span className="lp-footer2-h">{c.footer.legal}</span>
            <a href="/privacy">{c.footer.privacy}</a>
            <a href="/terms">{c.footer.terms}</a>
          </div>
        </div>
        <div className="lp-footer2-bottom">{c.footer.rights}</div>
      </footer>
    </div>
  );
}
