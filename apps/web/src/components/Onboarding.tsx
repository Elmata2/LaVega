import { useState } from "react";
import type { FormEvent } from "react";
import type { EntityScope } from "@lavega/core";
import { SCOPE_ORDER } from "../scope.js";
import { countryListIn, regionLabelIn, regionsFor } from "../countries.js";
import { useAppLocale, setAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import type { Locale } from "../locale.js";
import {
  getDefaultScope,
  getHomeRegion,
  getOwnerName,
  setDefaultScope,
  setHomeCountry,
  setHomeRegion,
  setOwnerName,
  storedHomeCountry,
} from "../settings.js";
import { markOnboardingSeen } from "../onboarding.js";
import Button from "./ui/Button.js";
import Card from "./ui/Card.js";
import { Field } from "./ui/Field.js";

/* DE EENMALIGE INSTELSTAP, na een verse kluis.
 *
 * WAAROM HIJ BESTAAT. `getHomeCountry()` viel terug op NL, met in zijn eigen
 * kop de reden erbij: "a local-first app has no signup to read this from". Dat
 * klopte, en het gevolg was dat iemand in Duitsland opende op Nederlandse
 * BTW-termijnen en de KOR, tot hij uit zichzelf Profiel vond. Dat is geen
 * voorkeur die je laat sudderen — het is een verkeerd antwoord op een
 * belastingvraag.
 *
 * WAT HIJ NIET IS. Geen registratie: er gaat hier niets naar een server en er
 * wordt geen account gemaakt. Alles wat deze stap zet is een voorkeur van dit
 * apparaat (taal, naam, land, regio, welke helft), precies dezelfde
 * localStorage-sleutels die Profiel ook schrijft. De serverkant van inloggen
 * staat los en blijft waar hij staat.
 *
 * WAAROM OVERSLAAN MAG. Elk veld heeft een eerlijke terugval en niets hier is
 * onomkeerbaar. Een verplichte stap voor een kluis die al werkt zou een
 * drempel zijn zonder dat er iets achter staat. */

type OnboardingProps = {
  /** Called once the preferences are written (or deliberately skipped). */
  onDone: () => void;
};

export default function Onboarding({ onDone }: OnboardingProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].onboarding;

  /* ELK VELD BEGINT OP WAT ER AL STAAT, en dat is geen nettigheid.
   *
   * Deze stap komt ook langs als iemand een BACK-UP terugzet op een nieuwe
   * browser: `gate` is dan "setup" (er is nog geen kluis) terwijl de persoon
   * allesbehalve nieuw is. Vaak heeft hij dan inderdaad nog geen voorkeuren —
   * die staan in localStorage en niet in de kluis — maar soms wél, en dan mag
   * "op Klaar drukken zonder iets aan te raken" niets veranderen. `scope` was
   * hardgecodeerd "personal" en zette een eerder gekozen "business" terug.
   *
   * `storedHomeCountry()` en niet `getHomeCountry()`: die laatste valt terug op
   * NL, en dat als voorselectie tonen is precies de bug die deze stap bestrijdt. */
  const owner = getOwnerName();
  const [first, setFirst] = useState(owner.first);
  const [last, setLast] = useState(owner.last);
  const [country, setCountry] = useState(storedHomeCountry);
  const [region, setRegion] = useState(getHomeRegion);
  const [scope, setScope] = useState<EntityScope>(getDefaultScope);

  const regionOptions = regionsFor(country);

  function finish(e: FormEvent) {
    e.preventDefault();
    // Alleen schrijven wat hij ook echt heeft ingevuld. Een leeg veld hier moet
    // "niet gezegd" blijven betekenen en mag geen lege naam of een gegokt land
    // over een eerder ingestelde waarde heen zetten.
    if (first.trim() || last.trim()) setOwnerName({ first: first.trim(), last: last.trim() });
    if (country) setHomeCountry(country);
    if (region.trim()) setHomeRegion(region.trim());
    setDefaultScope(scope);
    markOnboardingSeen();
    onDone();
  }

  function skip() {
    markOnboardingSeen();
    onDone();
  }

  return (
    /* Dezelfde opmaak als het kluisscherm ervóór: dit is de tweede helft van
     * dezelfde eerste start, en twee verschillende lay-outs achter elkaar
     * lezen als twee verschillende apps. `vault-gate` centreert, de kaart
     * houdt zijn breedte. */
    <div className="vault-gate">
      <Card as="form" className="vault-gate-card" aria-label={c.ariaLabel} onSubmit={finish}>
        <h2>{c.title}</h2>
        <p className="cell-sub">{c.intro}</p>
          <Field>
            <label htmlFor="ob-locale">{c.languageLabel}</label>
            <select
              id="ob-locale"
              value={locale}
              onChange={(e) => setAppLocale(e.target.value as Locale)}
            >
              <option value="nl">Nederlands</option>
              <option value="en">English</option>
            </select>
          </Field>

          <Field>
            <label htmlFor="ob-first">{c.firstNameLabel}</label>
            <input id="ob-first" value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field>
            <label htmlFor="ob-last">{c.lastNameLabel}</label>
            <input id="ob-last" value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
          <p className="cell-sub">{c.nameNote}</p>

          <Field>
            <label htmlFor="ob-country">{c.countryLabel}</label>
            <select
              id="ob-country"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                // Een regio hoort bij het land dat hij toen koos. Hem laten
                // staan zou "Bayern" onder Canada kunnen zetten.
                setRegion("");
              }}
            >
              <option value="">—</option>
              {countryListIn(locale).map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="cell-sub">{c.countryHint}</p>

          {country !== "" && (
            <Field>
              <label htmlFor="ob-region">{regionLabelIn(locale, country)}</label>
              {regionOptions.length > 0 ? (
                <select
                  id="ob-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="">—</option>
                  {regionOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="ob-region"
                  value={region}
                  placeholder={c.regionPlaceholder}
                  onChange={(e) => setRegion(e.target.value)}
                />
              )}
            </Field>
          )}

          <Field>
            <label htmlFor="ob-scope">{c.scopeLabel}</label>
            <select
              id="ob-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as EntityScope)}
            >
              {SCOPE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {shellCopy[locale].scope[s]}
                </option>
              ))}
            </select>
          </Field>
          <p className="cell-sub">{c.scopeHint}</p>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              {c.submit}
            </Button>
            <Button type="button" onClick={skip}>
              {c.skip}
            </Button>
          </div>
      </Card>
    </div>
  );
}
