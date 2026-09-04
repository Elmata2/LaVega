import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import CardSpiral from "./CardSpiral";
import { INVESTING_URL } from "../investing.js";

/** Deployed Google Apps Script web-app URL (…/exec) that appends waitlist rows
 *  to the "LaVega — Wachtlijst" Google Sheet. Empty until deployed → the form
 *  shows a "binnenkort" state instead of silently dropping sign-ups. */
const WAITLIST_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxouQ-TkXgdAipOfHJS9A-ChGqthOjDDxjngh8ytmiP2OOU4sbKVEB7CscuQz1QKcvT/exec";

/** Public marketing landing page. Warm-cream + espresso + tan, big EB Garamond
 *  serif (StrategiQ-inspired), broad audience (students → werkenden →
 *  ondernemers). The app isn't public yet — it's a waitlist front door: the
 *  prominent CTAs go to #wachtlijst; only the discreet header "Inloggen" enters
 *  the vault (`/app`) via `onEnter`, for owner/Railway testing. */
export default function Landing({ onEnter }: { onEnter: () => void }) {
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
  const [wlStatus, setWlStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submitWaitlist(e: FormEvent) {
    e.preventDefault();
    const email = wlEmail.trim();
    if (!wlReady || !email || wlStatus === "sending") return;
    setWlStatus("sending");
    try {
      await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        body: new URLSearchParams({ name: wlName.trim(), email, source: "lavega.dev" }),
      });
      setWlStatus("done");
      setWlName("");
      setWlEmail("");
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
          <a href="#agents">Agents</a>
          <a href="#privacy">Privacy</a>
          <a href="#how">Hoe het werkt</a>
          <a href="#wachtlijst">Wachtlijst</a>
          {INVESTING_URL && (
            <a
              href={INVESTING_URL}
              {...(INVESTING_URL.startsWith("http")
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              Investing
            </a>
          )}
        </nav>
        <button type="button" className="lp-btn lp-btn-dark" onClick={onEnter}>
          Inloggen
        </button>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <h1 className="lp-h1 lp-reveal">
          Al je rekeningen,
          <br />
          één helder getal.
        </h1>
        <p className="lp-sub lp-reveal">
          LaVega bundelt al je rekeningen — bij elke bank — in één overzicht. Weet op elk moment
          precies hoeveel je hebt en waar je geld heen gaat, reserveer je belasting, en haal het
          meeste uit je punten. Lokaal-first: je cijfers blijven op je eigen apparaat.
        </p>
        <div className="lp-cta-row lp-reveal">
          <a className="lp-btn lp-btn-dark lp-btn-lg" href="#wachtlijst">
            Kom op de wachtlijst <span aria-hidden="true">→</span>
          </a>
          <a className="lp-btn lp-btn-light lp-btn-lg" href="#how">
            Bekijk hoe het werkt
          </a>
        </div>

        {/* Floating product illustration */}
        <div className="lp-stage lp-reveal" aria-hidden="true">
          <div className="lp-device">
            <div className="lp-device-eyebrow">Totaalpositie</div>
            <div className="lp-device-value">€12.480</div>
            <div className="lp-device-delta">▲ 4,6% deze maand</div>
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
                <span>Boodschappen</span>
                <span>28%</span>
              </div>
              <div>
                <span>Vaste lasten</span>
                <span>34%</span>
              </div>
              <div>
                <span>Sparen</span>
                <span>18%</span>
              </div>
            </div>
          </div>
          <div className="lp-chip lp-chip-a lp-float">
            <div className="lp-chip-label">Deze maand gespaard</div>
            <div className="lp-chip-value lp-pos">+€420</div>
          </div>
          <div className="lp-chip lp-chip-b lp-float lp-float-slow">
            <div className="lp-chip-label">Forecast · 13 weken</div>
            <div className="lp-chip-value lp-pos">geen tekort</div>
          </div>
          <div className="lp-chip lp-chip-c lp-float lp-float-slower">
            <span className="lp-lock">🔒</span> Lokaal &amp; versleuteld
          </div>
        </div>
      </section>

      {/* Signature scroll section (GSAP card spiral + tagline) */}
      <CardSpiral />

      {/* Kern-tegels — waarom LaVega (SS1-inspired, our fonts + warm palet) */}
      <section className="lp-section lp-strengths" id="waarom">
        <div className="lp-strengths-head lp-reveal">
          <h2 className="lp-h2 lp-strengths-title">Al je geldzaken, samen op één plek</h2>
          <div className="lp-strengths-aside">
            <p className="lp-sub lp-strengths-sub">
              We doen er alles aan om je een naadloze ervaring te geven — snel, veilig en compleet.
              Eén helder beeld van al je rekeningen, waar je ook bankiert.
            </p>
            <a className="lp-btn lp-btn-dark" href="#agents">
              Ontdek meer <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <div className="lp-tiles lp-reveal">
          <article className="lp-tile">
            <h3 className="lp-tile-title">Snel &amp; soepel</h3>
            <div className="lp-ill lp-ill-fast" aria-hidden="true">
              <span className="c c1" />
              <span className="c c2" />
              <span className="c c3" />
              <span className="c c4" />
            </div>
          </article>
          <article className="lp-tile">
            <h3 className="lp-tile-title">Al je rekeningen gekoppeld</h3>
            <div className="lp-ill lp-ill-toggles" aria-hidden="true">
              <span className="tg" />
              <span className="tg on" />
              <span className="tg" />
            </div>
          </article>
          <article className="lp-tile">
            <h3 className="lp-tile-title">Sterke versleuteling</h3>
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
            <h3 className="lp-tile-title">Eén compleet overzicht</h3>
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
            <p className="lp-eyebrow lp-eyebrow-left">De agents</p>
            <h2 className="lp-h2 lp-strengths-title">Slimme agents die het werk doen</h2>
          </div>
          <div className="lp-carousel-nav">
            <button type="button" aria-label="Vorige" onClick={() => scrollAgents(-1)}>
              ←
            </button>
            <button
              type="button"
              aria-label="Volgende"
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
              t: "Facturen-agent",
              d: "Sleep een PDF-factuur erin en de agent leest de bedragen en vervaldata automatisch uit — meteen zichtbaar in je cashflow, jij bevestigt.",
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
              t: "Belasting-agent",
              d: "Reserveert automatisch je btw en bewaakt elke aangifte-deadline, zodat je nooit voor verrassingen komt te staan.",
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
              t: "Koersen-agent",
              d: "Moet je wisselen of overmaken in vreemde valuta? De agent zoekt realtime de goedkoopste route (Wise, Revolut, je bank).",
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
              t: "Punten-agent",
              d: "Houdt je punten bij en zoekt live op wat ze écht waard zijn en hoe je ze het slimst inwisselt, bijvoorbeeld voor reizen.",
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
          <h2 className="lp-h2">Jouw data blijft van jou.</h2>
          <p className="lp-sub">
            Alles staat versleuteld op je eigen apparaat. Bankkoppelingen zijn alleen-lezen. Geen
            cloud, geen meekijken — tenzij jij een agent expliciet aanzet. Zo simpel is het.
          </p>
          <ul className="lp-ticks">
            <li>Lokaal-first: geen server bewaart je transacties</li>
            <li>Alleen-lezen bankkoppeling (geen betalingen)</li>
            <li>Versleutelde kluis met je eigen wachtwoord</li>
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section" id="how">
        <p className="lp-eyebrow lp-reveal">Hoe het werkt</p>
        <h2 className="lp-h2 lp-reveal">In een paar minuten opgezet</h2>
        <div className="lp-steps lp-reveal">
          {[
            {
              n: "1",
              t: "Importeer of koppel",
              d: "Sleep je bankexports erin of koppel je bank alleen-lezen.",
            },
            {
              n: "2",
              t: "LaVega rekent",
              d: "Categoriseert automatisch en voorspelt je kaspositie vooruit.",
            },
            {
              n: "3",
              t: "Vraag de assistent",
              d: "Stel je vraag — de agent zoekt realtime op en denkt met je mee.",
            },
          ].map((s) => (
            <div className="lp-step" key={s.n}>
              <div className="lp-step-n">{s.n}</div>
              <h3 className="lp-card-title">{s.t}</h3>
              <p className="lp-card-text">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section" id="faq">
        <p className="lp-eyebrow lp-reveal">FAQ</p>
        <h2 className="lp-h2 lp-reveal">Veelgestelde vragen</h2>
        <div className="lp-faq lp-reveal">
          {[
            {
              q: "Is mijn data veilig?",
              a: "Ja. Alles staat versleuteld op je eigen apparaat — er is geen cloud die je transacties bewaart. Bankkoppelingen zijn altijd alleen-lezen.",
            },
            {
              q: "Moet ik mijn bank koppelen?",
              a: "Nee. Je kunt ook simpelweg je bankexports importeren. Koppelen kan wél en is dan alleen-lezen (nooit betalingen).",
            },
            {
              q: "Voor wie is LaVega?",
              a: "Van studenten die grip willen op hun budget tot werkenden en ondernemers die hun rekeningen, cashflow en btw willen beheren.",
            },
            {
              q: "Werkt het met meerdere rekeningen en BV's?",
              a: "Ja — LaVega bundelt al je rekeningen, privé én zakelijk, in één helder overzicht per entiteit en geconsolideerd.",
            },
            {
              q: "Gebruikt de AI-assistent mijn gegevens?",
              a: "Alleen als jij dat aanzet, per onderdeel, en je bevestigt zelf wat er gedeeld wordt. Standaard staat het uit.",
            },
          ].map((f) => (
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
          <p className="lp-eyebrow">Wachtlijst</p>
          <h2 className="lp-h2">Wees er als eerste bij</h2>
          <p className="lp-sub">
            LaVega rolt stap voor stap uit. Laat je e-mail achter en we laten je weten zodra je aan
            de beurt bent — plus af en toe een update over nieuwe agents.
          </p>
          {wlStatus === "done" ? (
            <p className="lp-waitlist-done">
              Je staat op de lijst! 🎉 We mailen je zodra je aan de beurt bent.
            </p>
          ) : (
            <form className="lp-waitlist-form" onSubmit={submitWaitlist}>
              <input
                type="text"
                className="lp-input"
                placeholder="Naam (optioneel)"
                aria-label="Naam"
                value={wlName}
                onChange={(e) => setWlName(e.target.value)}
                disabled={!wlReady || wlStatus === "sending"}
              />
              <input
                type="email"
                className="lp-input"
                placeholder="jouw@email.nl"
                aria-label="E-mailadres"
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
                    ? "Bezig…"
                    : "Zet me op de lijst"
                  : "Binnenkort"}
              </button>
            </form>
          )}
          {!wlReady && <p className="lp-waitlist-note">De wachtlijst opent zeer binnenkort.</p>}
          {wlStatus === "error" && (
            <p className="lp-waitlist-note">Er ging iets mis — probeer het zo nog eens.</p>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer2">
        <div className="lp-footer2-cta lp-reveal">
          <h2 className="lp-h2">Klaar om grip te krijgen op je geld?</h2>
          <a className="lp-btn lp-btn-tan lp-btn-lg" href="#wachtlijst">
            Kom op de wachtlijst <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="lp-footer2-grid">
          <div className="lp-footer2-about">
            <div className="lp-footer2-brand">LaVega</div>
            <p className="lp-footer2-note">
              Lokaal-first personal finance — van student tot ondernemer.
            </p>
          </div>
          <div className="lp-footer2-col">
            <span className="lp-footer2-h">Product</span>
            <a href="#agents">Agents</a>
            <a href="#how">Hoe het werkt</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-footer2-col">
            <span className="lp-footer2-h">Juridisch</span>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Voorwaarden</a>
          </div>
        </div>
        <div className="lp-footer2-bottom">© 2026 LaVega · lokaal-first</div>
      </footer>
    </div>
  );
}
