import { useEffect, useRef } from "react";

/** Public marketing landing page. Warm-cream + espresso + tan, big EB Garamond
 *  serif — the StrategiQ-inspired look, LaVega's fonts + local-first story.
 *  Purely presentational; "Aan de slag / Inloggen" enters the app (#app). */
export default function Landing({ onEnter }: { onEnter: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Let the (tall) landing scroll even though the app frame sets body overflow
  // hidden; restore on unmount so the dashboard frame behaves again.
  useEffect(() => {
    document.body.classList.add("lp-scroll");
    return () => document.body.classList.remove("lp-scroll");
  }, []);

  // Scroll-reveal: fade/rise elements in as they enter the viewport. Honours
  // prefers-reduced-motion via CSS (the .lp-reveal base stays visible there).
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
        <button type="button" className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          LaVega
        </button>
        <nav className="lp-nav-links">
          <a href="#agents">Agents</a>
          <a href="#privacy">Privacy</a>
          <a href="#how">Hoe het werkt</a>
        </nav>
        <button type="button" className="lp-btn lp-btn-dark" onClick={onEnter}>
          Inloggen
        </button>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <h1 className="lp-h1 lp-reveal">
          Overzicht en grip,<br />over al je BV&apos;s heen.
        </h1>
        <p className="lp-sub lp-reveal">
          LaVega bundelt al je rekeningen tot één helder beeld, voorspelt je kaspositie 13 weken
          vooruit en zet slimme agents in voor facturen, belasting, koersen en punten.
          Lokaal-first — jouw data blijft op je eigen apparaat.
        </p>
        <div className="lp-cta-row lp-reveal">
          <button type="button" className="lp-btn lp-btn-dark lp-btn-lg" onClick={onEnter}>
            Aan de slag <span aria-hidden="true">→</span>
          </button>
          <a className="lp-btn lp-btn-light lp-btn-lg" href="#how">
            Bekijk hoe het werkt
          </a>
        </div>

        {/* Floating product illustration */}
        <div className="lp-stage lp-reveal" aria-hidden="true">
          <div className="lp-device">
            <div className="lp-device-eyebrow">Totaalpositie</div>
            <div className="lp-device-value">€128.480</div>
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
              <div><span>Boodschappen</span><span>28%</span></div>
              <div><span>Vaste lasten</span><span>34%</span></div>
              <div><span>Sparen</span><span>18%</span></div>
            </div>
          </div>
          <div className="lp-chip lp-chip-a lp-float">
            <div className="lp-chip-label">BTW gereserveerd</div>
            <div className="lp-chip-value">€4.200</div>
          </div>
          <div className="lp-chip lp-chip-b lp-float lp-float-slow">
            <div className="lp-chip-label">13-weken forecast</div>
            <div className="lp-chip-value lp-pos">geen tekort</div>
          </div>
          <div className="lp-chip lp-chip-c lp-float lp-float-slower">
            <span className="lp-lock">🔒</span> Lokaal &amp; versleuteld
          </div>
        </div>
      </section>

      {/* Agents */}
      <section className="lp-section" id="agents">
        <p className="lp-eyebrow lp-reveal">De agents</p>
        <h2 className="lp-h2 lp-reveal">Vier agents die met je meedenken</h2>
        <div className="lp-grid lp-reveal">
          {[
            { icon: "🧾", t: "Facturen", d: "Leest PDF-facturen automatisch uit en zet ze in je cashflow." },
            { icon: "🏛️", t: "Belasting", d: "Reserveert je btw en bewaakt elke aangifte-deadline." },
            { icon: "💱", t: "Koersen", d: "Vindt de goedkoopste route om valuta te wisselen — realtime." },
            { icon: "⭐", t: "Punten", d: "Houdt je loyalty-punten bij en wat ze écht waard zijn." },
          ].map((a) => (
            <div className="lp-card" key={a.t}>
              <div className="lp-card-icon">{a.icon}</div>
              <h3 className="lp-card-title">{a.t}</h3>
              <p className="lp-card-text">{a.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Card marquee (decorative) */}
      <div className="lp-marquee" aria-hidden="true">
        <div className="lp-marquee-track">
          {["Kasoverzicht", "13-weken forecast", "BTW-reservering", "Facturen-agent", "Valuta-routes", "Punten", "Alle banken", "Versleutelde kluis", "Kasoverzicht", "13-weken forecast", "BTW-reservering", "Facturen-agent", "Valuta-routes", "Punten", "Alle banken", "Versleutelde kluis"].map((t, i) => (
            <span className="lp-pill" key={i}>{t}</span>
          ))}
        </div>
      </div>

      {/* Privacy */}
      <section className="lp-section lp-privacy" id="privacy">
        <div className="lp-privacy-inner lp-reveal">
          <h2 className="lp-h2">Jouw data blijft van jou.</h2>
          <p className="lp-sub">
            Alles staat versleuteld op je eigen apparaat. Bankkoppelingen zijn alleen-lezen. Geen cloud,
            geen meekijken — tenzij jij een agent expliciet aanzet. Zo simpel is het.
          </p>
          <ul className="lp-ticks">
            <li>Lokaal-first: geen server bewaart je transacties</li>
            <li>Alleen-lezen bankkoppeling (AIS, geen betalingen)</li>
            <li>Versleutelde kluis met je eigen wachtwoord</li>
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section" id="how">
        <p className="lp-eyebrow lp-reveal">Hoe het werkt</p>
        <h2 className="lp-h2 lp-reveal">Van bankexport tot forecast in minuten</h2>
        <div className="lp-steps lp-reveal">
          {[
            { n: "1", t: "Importeer of koppel", d: "Sleep je bankexports erin of koppel je bank alleen-lezen." },
            { n: "2", t: "LaVega rekent", d: "Categoriseert automatisch en voorspelt je kaspositie 13 weken vooruit." },
            { n: "3", t: "Vraag de assistent", d: "Stel je vraag — de agent zoekt realtime op en denkt met je mee." },
          ].map((s) => (
            <div className="lp-step" key={s.n}>
              <div className="lp-step-n">{s.n}</div>
              <h3 className="lp-card-title">{s.t}</h3>
              <p className="lp-card-text">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="lp-cta-band lp-reveal">
        <h2 className="lp-h2">Klaar om grip te krijgen op je geld?</h2>
        <button type="button" className="lp-btn lp-btn-tan lp-btn-lg" onClick={onEnter}>
          Aan de slag <span aria-hidden="true">→</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <span className="lp-brand-sm">LaVega</span>
        <span className="lp-foot-note">lokaal-first personal finance</span>
        <span className="lp-foot-links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Voorwaarden</a>
        </span>
      </footer>
    </div>
  );
}
