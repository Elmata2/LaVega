import { useEffect, useMemo, useState } from "react";
import type { Account, CatalogueEntryLike, FxRate, FxRouteOption, LearnedFact } from "@lavega/core";
import {
  FX_RATE_FALLBACK,
  accountLabel,
  crossRate,
  fxExtraCost,
  fxRouteDefault,
  parseFxRatePayload,
  rankFxRoutes,
} from "@lavega/core";
import { API_BASE } from "../api";
import Module, { ModuleMenu } from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import WorldMap from "../components/WorldMap";
import catalogue from "../../../../docs/catalog/catalog.json";
import "../styles/views.css";

/* Valuta — "Transfer money": from where, to where, how much, and what ARRIVES.
 *
 * TWO THINGS THE 20 AUGUST REVIEW CHANGED HERE.
 *
 * 1. ONE ROW PER BANK. "Just show one ING, because since we're converting it
 *    doesn't matter, just show the banks once." It used to rank per PRODUCT via
 *    `rankJourneys`, so ING arrived three times. The collapse lives in
 *    `rankFxRoutes` (packages/core/src/fxRoutes.ts) with the rules that keep a
 *    merge honest — nothing dropped, the product behind every figure named.
 *
 * 2. EVERY BANK, NOT ONLY HIS. "When I transfer a thousand euros to USD it should
 *    choose the best account or bank, and if the user wants to change they can
 *    choose through all the banks available and the fee difference." So the list
 *    is the whole catalogue's 73 covered surcharges, each priced against the
 *    chosen route in euros, and a bank he does not hold is marked as such —
 *    otherwise the screen recommends a transfer he cannot make.
 *
 * The multi-leg pricing (move to Revolut via iDEAL first, then pay) stays in the
 * travel block on Overzicht. That answers "which card do I pay with abroad"; this
 * screen answers "where do I convert", and one number per bank is the answer to
 * the second question.
 *
 * The rule that still shapes the whole screen: an unknown cost is NOT zero. When
 * the chosen route has no established figure, "wat er aankomt" stays "onbekend"
 * and the mid-market amount is shown separately, labelled as market value.
 *
 * The catalogue is imported at BUILD time — like `catalogue-rates.ts`, and for the
 * same reason: nothing about which banks a user compares should leave the device.
 *
 * THE MAP (components/WorldMap.tsx) is a THIRD way to set `to`, next to the
 * dropdown and picking an account — you rarely think "USD", you think "Japan".
 * It is only an input: it sets the target currency and nothing else, so there is
 * one calculation on this screen and not two that can disagree. It does NOT
 * always set one, and that is the point — a euro country, a currency we have no
 * rate for and a country with two currencies are three different answers, none
 * of which may end up as a 0% route in the ranking. The map states the answer;
 * `to` only moves when there is a rate to move it to.
 */

const CATALOGUE_FX: readonly CatalogueEntryLike[] =
  (catalogue as { entries?: CatalogueEntryLike[] }).entries ?? [];

/** How many alternatives to show before asking. His own banks are ALWAYS shown,
 *  however far down the ranking they sit — a bank he holds may never be hidden
 *  behind a "show more". */
const VISIBLE_ROUTES = 8;

type ValutaProps = {
  accounts: Account[];
  /** Learned card/route terms from the vault — including his own corrections,
   *  which outrank the catalogue for a product he holds. Absent means "we only
   *  know what the catalogue says", which is still a lot more than nothing. */
  facts?: readonly LearnedFact[];
  /** The product catalogue. Injectable so a test can state its own market. */
  entries?: readonly CatalogueEntryLike[];
};

const NO_ACCOUNT = "";

function fmt(n: number, ccy: string): string {
  try {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);
  } catch {
    // A currency code Intl doesn't know: still show the number, never a blank.
    return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })} ${ccy}`;
  }
}

const pctText = (p: number) => `${p.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

/** What to call a product class that is NOT a bank card. The cheapest figures in
 *  the catalogue belong to prepaid and crypto cards; they are ranked on the same
 *  evidence as the rest, and the row says what they are so the ranking does not
 *  quietly pass one off as a bank account. */
const KIND_LABEL: Record<string, string> = {
  prepaid: "prepaidkaart",
  crypto: "cryptokaart",
  beleggingsrekening: "beleggingsrekening",
};

/** One bank, once. Selectable, because the whole point is that he can overrule
 *  the default — and priced against the route currently chosen, in money. */
function RouteRow({
  route,
  chosen,
  against,
  amount,
  currency,
  onPick,
}: {
  route: FxRouteOption;
  chosen: boolean;
  against: FxRouteOption | null;
  amount: number;
  currency: string;
  onPick: () => void;
}) {
  const delta = fxExtraCost(route, against, amount);
  const diff =
    chosen || delta === null
      ? null
      : delta === 0
        ? "even duur"
        : `${fmt(Math.abs(delta), currency)} ${delta < 0 ? "minder" : "meer"}`;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={chosen}
        className={`travel-journey${chosen ? " travel-journey-best" : ""}${route.pct === null ? " travel-journey-unknown" : ""}`}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "block" }}
      >
        <div className="travel-journey-head">
          <span className="travel-journey-name">
            {route.bank}{" "}
            <span className="badge">{route.held ? "van jou" : "niet van jou"}</span>
            {route.kind && KIND_LABEL[route.kind] ? (
              <>
                {" "}
                <span className="badge">{KIND_LABEL[route.kind]}</span>
              </>
            ) : null}
          </span>
          <span className="travel-journey-cost">
            {route.pct === null ? "kosten onbekend" : pctText(route.pct)}
            {diff ? ` · ${diff}` : ""}
          </span>
        </div>
        <p className="cell-sub" style={{ margin: 0 }}>
          {route.why}
          {route.asOf ? ` (bron: ${route.asOf})` : ""}
        </p>
      </button>
    </li>
  );
}

export default function Valuta({ accounts, facts = [], entries = CATALOGUE_FX }: ValutaProps) {
  const [rate, setRate] = useState<FxRate>(FX_RATE_FALLBACK);
  const [source, setSource] = useState<"live" | "offline">("offline");
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("USD");
  const [fromKey, setFromKey] = useState(NO_ACCOUNT);
  const [toKey, setToKey] = useState(NO_ACCOUNT);
  const [pickedBank, setPickedBank] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let ok = true;
    void fetch(`${API_BASE}/api/fx/rate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const parsed = parseFxRatePayload(j);
        if (ok && parsed) {
          setRate(parsed);
          setSource("live");
        }
      })
      .catch(() => {/* keep fallback */});
    return () => { ok = false; };
  }, []);

  const currencies = useMemo(
    () => [rate.base, ...Object.keys(rate.rates)].filter((v, i, a) => a.indexOf(v) === i).sort(),
    [rate],
  );

  const byKey = useMemo(() => new Map(accounts.map((a) => [a.key, a])), [accounts]);
  const fromAcc = fromKey ? byKey.get(fromKey) ?? null : null;
  const toAcc = toKey ? byKey.get(toKey) ?? null : null;

  const amt = Number(amount.replace(",", ".")) || 0;

  const mid = useMemo(() => {
    try {
      return crossRate(from, to, rate);
    } catch {
      return null;
    }
  }, [from, to, rate]);

  // THE ranking: one row per bank, over the whole catalogue plus what the vault
  // knows about his own cards.
  const routes = useMemo(() => rankFxRoutes({ accounts, facts, entries }), [accounts, facts, entries]);
  const auto = useMemo(() => fxRouteDefault(routes), [routes]);
  const chosen = useMemo(
    () => (pickedBank ? routes.find((r) => r.key === pickedBank) ?? auto : auto),
    [routes, pickedBank, auto],
  );
  const cheapest = routes.find((r) => r.pct !== null) ?? null;
  const beats =
    chosen && cheapest && chosen.pct !== null && cheapest.pct !== null && cheapest.pct < chosen.pct
      ? cheapest
      : null;

  const sameCurrency = from === to;
  // No conversion means no conversion cost — that is a fact, not an assumption.
  // Otherwise the cost is the chosen route's; unknown stays unknown.
  const costPct = sameCurrency ? 0 : chosen?.pct ?? null;
  const grossReceived = mid !== null ? amt * mid : null;
  const netReceived = grossReceived !== null && costPct !== null ? grossReceived * (1 - costPct / 100) : null;
  const costInFrom = costPct !== null ? (amt * costPct) / 100 : null;

  const heldBanks = useMemo(() => routes.filter((r) => r.held), [routes]);
  const heldUnknown = heldBanks.filter((r) => r.pct === null).map((r) => r.bank);

  /** Why there is no route to price this with — the actual reason, not a generic
   *  "onbekend". Getting this wrong once cost three days of wrong fixes. */
  const noRouteReason = (): string => {
    if (heldBanks.length === 0) {
      return accounts.length === 0
        ? "Er staat nog geen rekening in LaVega, dus er is geen bank om via te wisselen."
        : "Geen van je rekeningen hangt aan een bank die LaVega kan opzoeken — vul de bank in bij Rekeningen.";
    }
    return `Van ${heldUnknown.join(", ")} kent LaVega de koersopslag niet, en een onbekend tarief is geen 0%.`;
  };

  const visible = showAll ? routes : routes.filter((r, i) => i < VISIBLE_ROUTES || r.held);
  const hidden = routes.length - visible.length;

  /** Selecting an account sets the leg's currency to that account's own — the
   *  currency of the money is a property of the account, not a free choice. */
  function pickFrom(key: string) {
    setFromKey(key);
    const c = key ? byKey.get(key)?.currency : undefined;
    if (c && /^[A-Za-z]{3}$/.test(c)) setFrom(c.toUpperCase());
  }
  function pickTo(key: string) {
    setToKey(key);
    const c = key ? byKey.get(key)?.currency : undefined;
    if (c && /^[A-Za-z]{3}$/.test(c)) setTo(c.toUpperCase());
  }
  function swap() {
    setFrom(to);
    setTo(from);
    setFromKey(toKey);
    setToKey(fromKey);
  }

  const available = (a: Account | null) =>
    a === null ? "—" : a.balance === null ? "onbekend" : fmt(a.balance, a.currency || "EUR");

  return (
    <>
      <div className="view-head">
        <h2>Geld overzetten</h2>
        <span className="eyebrow">live ECB-middenkoers · koersopslag per bank uit de catalogus</span>
      </div>

      <ModuleGrid className="grid-2" label="Valuta">
        <Module
          title="Overzetten"
          height="tall"
          menu={
            <>
              <button
                type="button"
                className="module-info"
                aria-label="Uitleg bij dit bedrag"
                aria-expanded={showInfo}
                title="Uitleg bij dit bedrag"
                onClick={() => setShowInfo((v) => !v)}
              >
                <span aria-hidden="true">i</span>
              </button>
              <ModuleMenu label="Koersbron" onClick={() => setShowSource((v) => !v)} />
            </>
          }
        >
          <div className="xfer">
            <div className="xfer-leg">
              <div className="xfer-leg-head">
                <span className="xfer-leg-label">Van rekening</span>
                <select className="xfer-account" aria-label="Van rekening" value={fromKey} onChange={(e) => pickFrom(e.target.value)}>
                  <option value={NO_ACCOUNT}>geen rekening gekozen</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>{accountLabel(a)}</option>
                  ))}
                </select>
              </div>
              <div className="xfer-amount-row">
                <input
                  className="xfer-amount"
                  type="number"
                  step={0.01}
                  min={0}
                  value={amount}
                  aria-label="Bedrag"
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select className="xfer-ccy" aria-label="Van valuta" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="xfer-foot">
                <span>Beschikbaar</span>
                <span>{available(fromAcc)}</span>
              </div>
            </div>

            <button type="button" className="xfer-swap" aria-label="Wissel van en naar" onClick={swap}>
              <span aria-hidden="true">⇅</span>
            </button>

            <div className="xfer-leg">
              <div className="xfer-leg-head">
                <span className="xfer-leg-label">Naar rekening</span>
                <select className="xfer-account" aria-label="Naar rekening" value={toKey} onChange={(e) => pickTo(e.target.value)}>
                  <option value={NO_ACCOUNT}>geen rekening gekozen</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>{accountLabel(a)}</option>
                  ))}
                </select>
              </div>
              <div className="xfer-amount-row">
                <span className={`xfer-out${netReceived === null ? " xfer-out-unknown" : ""}`} data-testid="arrives">
                  {netReceived === null ? "onbekend" : fmt(netReceived, to)}
                </span>
                <select className="xfer-ccy" aria-label="Naar valuta" value={to} onChange={(e) => setTo(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="xfer-foot">
                <span>Komt aan na kosten · beschikbaar</span>
                <span>{available(toAcc)}</span>
              </div>
            </div>
          </div>

          <p className="reason" style={{ marginTop: "var(--sp-4)" }} data-testid="uitleg">
            {netReceived === null ? (
              <>
                <strong>Wat er aankomt is onbekend.</strong>{" "}
                {mid === null
                  ? `LaVega heeft geen koers voor ${from} → ${to}.`
                  : (
                    <>
                      Tegen de middenkoers is dit {fmt(grossReceived ?? 0, to)} waard, maar dat is de marktwaarde
                      en niet het bedrag dat aankomt. {noRouteReason()}
                    </>
                  )}
              </>
            ) : (
              <>
                Je zet <span className="reason-figure">{fmt(amt, from)}</span> over,{" "}
                {sameCurrency ? (
                  <>zonder omwisseling. Er komt <span className="reason-figure">{fmt(netReceived, to)}</span> aan.</>
                ) : (
                  <>
                    tegen middenkoers {mid?.toFixed(4)} is dat {fmt(grossReceived ?? 0, to)}. Via{" "}
                    <strong>{chosen?.bank}</strong> kost dat {pctText(costPct ?? 0)} ({fmt(costInFrom ?? 0, from)}),
                    dus er komt <span className="reason-figure">{fmt(netReceived, to)}</span> aan.
                  </>
                )}
              </>
            )}
          </p>

          {chosen && chosen.pct !== null && !sameCurrency && (
            <p className="cell-sub" data-testid="gekozen-route">
              {chosen.mine
                ? `Gerekend met ${chosen.product}, het product dat je hier hebt.`
                : `Gerekend met ${chosen.product}${chosen.held ? " — controleer of dat jouw pakket is" : " — deze bank heb je nog niet"}.`}
            </p>
          )}

          {beats && !sameCurrency && (
            <p className="reason" data-testid="goedkoper">
              <strong>Goedkoper kan.</strong> {beats.bank} rekent {pctText(beats.pct ?? 0)} — dat is{" "}
              {fmt(Math.abs(fxExtraCost(beats, chosen ?? null, amt) ?? 0), from)} minder op dit bedrag.{" "}
              {beats.held
                ? "Die bank heb je al; kies hem in de lijst."
                : "Die bank heb je niet — je zou er eerst rekening bij moeten openen."}
            </p>
          )}

          {showSource && (
            <div className="info-panel">
              <p>
                <strong>Koers:</strong> {source === "live" ? `live ECB-middenkoers via Frankfurter, peildatum ${rate.date}` : `offline momentopname van ${rate.date}`}.
              </p>
              <p>
                <strong>Kosten:</strong> de koersopslag zoals de bank die zelf in haar tarievenoverzicht noemt.
                Elke regel draagt de bron en de datum die dat document noemt.
              </p>
              <p>Er wordt niets over je rekeningen verstuurd om die koers of die tarieven op te halen.</p>
            </div>
          )}

          {showInfo && (
            <div className="info-panel">
              <p>
                <strong>De lijst gaat over alle banken die LaVega kan onderbouwen</strong> — niet alleen die van
                jou. Standaard rekent LaVega met de goedkoopste route die je vandaag echt kunt gebruiken; een bank
                die je niet hebt staat erbij, met het verschil in euro's, maar wordt nooit stilzwijgend gekozen.
              </p>
              <p>
                Eén regel per bank: bij overzetten maakt het product niet uit, dus dezelfde bank staat niet
                driemaal in de lijst. Welk product achter het tarief zit, staat er wel bij — "ING 0%" geldt alleen
                voor de Platinumcard.
              </p>
              {costPct === null ? (
                <p>{noRouteReason()} Zolang dat zo is, kan LaVega niet zeggen wat er aankomt. Een onbekend tarief is geen 0%.</p>
              ) : (
                <p>
                  <strong>Waar overstappen je zou verslaan:</strong> je huidige keuze kost {pctText(costPct)}.
                  Elke bank die minder rekent, houdt op dit bedrag meer dan {fmt(costInFrom ?? 0, from)} voor je
                  over — precies het verschil dat achter elke regel staat.
                </p>
              )}
              {heldUnknown.length > 0 && (
                <p className="cell-sub">
                  Zonder bekend tarief, dus onderaan: {heldUnknown.join(", ")}.
                </p>
              )}
            </div>
          )}
        </Module>

        <Module
          title="Alle banken, goedkoopste eerst"
          height="tall"
          footer={
            <span>
              {routes.length === 0
                ? "Nog geen bank met een onderbouwd tarief."
                : `${routes.length} banken · verschil ten opzichte van ${chosen ? chosen.bank : "de gekozen route"} op ${fmt(amt, from)}`}
            </span>
          }
          menu={
            pickedBank && auto && pickedBank !== auto.key ? (
              <ModuleMenu label="Terug naar beste" onClick={() => setPickedBank(null)} />
            ) : undefined
          }
        >
          {routes.length === 0 ? (
            <div className="empty-guide">
              <p>Nog geen bank om te rangschikken.</p>
              <ul>
                <li>De catalogus levert de tarieven; die zit in de app en wordt niet opgehaald.</li>
                <li>Een tarief telt alleen mee met waarde, bron, datum én voorwaarden — anders wordt het geweigerd.</li>
                <li>Rekeningen zonder bank kunnen niet opgezocht worden; vul de bank in bij Rekeningen.</li>
              </ul>
            </div>
          ) : (
            <>
              <ul className="travel-journeys">
                {visible.map((r) => (
                  <RouteRow
                    key={r.key}
                    route={r}
                    chosen={chosen?.key === r.key}
                    against={chosen ?? null}
                    amount={amt}
                    currency={from}
                    onPick={() => setPickedBank(r.key)}
                  />
                ))}
              </ul>
              {hidden > 0 && (
                <button type="button" className="btn" style={{ marginTop: "var(--sp-3)" }} onClick={() => setShowAll(true)}>
                  Nog {hidden} {hidden === 1 ? "bank" : "banken"} tonen
                </button>
              )}
            </>
          )}
        </Module>

        <Module
          title="Waar ga je heen?"
          span={2}
          className="module-hug"
          footer={<span>De kaart zet alleen de doelvaluta hierboven — er komt geen tweede berekening bij.</span>}
        >
          <WorldMap value={to} from={from} onPick={setTo} supported={currencies} />
        </Module>
      </ModuleGrid>
    </>
  );
}
