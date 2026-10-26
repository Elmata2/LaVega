import { useEffect, useRef, useState } from "react";
import type { Account, Tx } from "@lavega/core";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import Field from "../components/ui/Field.js";
import { setAppLocale } from "../appLocale.js";
import type { IntakeCopy } from "../copy/intake.js";
import { countryListIn, regionLabelIn, regionsFor } from "../countries.js";
import type { Locale } from "../locale.js";
import type { OwnerName } from "../settings.js";
import Import from "../views/Import.js";

type Choice = "bank" | "upload" | "none";

type Props = {
  copy: IntakeCopy;
  locale: Locale;
  accounts: Account[];
  txs: Tx[];
  busy: boolean;
  entity: string;
  onEntityChange: (entity: string) => void;
  onImport: (file: File) => void | Promise<void>;
  onRefreshBank: () => void;
  homeCountry: string;
  onHomeCountryChange: (code: string) => void;
  homeRegion: string;
  ownerName: OwnerName;
  /** Called only with a name he actually typed; blank is never written. */
  onOwnerNameChange: (name: OwnerName) => void;
  onHomeRegionChange: (region: string) => void;
  /** Saves the choice; resolves once it is stored. */
  onChoose: (choice: Choice) => Promise<void>;
};

/** Step 0: data first, offered and never required. Upload and bank link sit
 *  inline; an upload that adds transactions moves the intake on by itself. */
export default function Step0(p: Props) {
  const { copy: c, locale } = p;
  const s = c.step0;
  const baseline = useRef(p.txs.length);
  const [waiting, setWaiting] = useState(false);
  const [name, setName] = useState(p.ownerName);
  function changeName(next: OwnerName) {
    setName(next);
    if (next.first.trim() || next.last.trim()) p.onOwnerNameChange(next);
  }

  useEffect(() => {
    if (waiting && p.txs.length > baseline.current) {
      setWaiting(false);
      void p.onChoose("upload");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, p.txs.length]);

  const regions = regionsFor(p.homeCountry);
  return (
    <>
      <Card as="section" aria-label={s.title}>
        <h2>{s.title}</h2>
        <p>{s.intro}</p>
        <p className="text-muted text-[0.85rem]">{s.tradeNote}</p>
      </Card>

      <Card as="section" aria-label={s.settingsTitle}>
        <h2>{s.settingsTitle}</h2>
        <Field>
          <label htmlFor="in-locale">{s.language}</label>
          <select
            id="in-locale"
            value={locale}
            onChange={(e) => setAppLocale(e.target.value as Locale)}
          >
            {s.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <label htmlFor="in-country">{s.country}</label>
          <select
            id="in-country"
            value={p.homeCountry}
            onChange={(e) => {
              p.onHomeCountryChange(e.target.value);
              p.onHomeRegionChange("");
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
        <p className="text-muted text-[0.85rem]">{s.countryHint}</p>
        {p.homeCountry !== "" && (
          <Field>
            <label htmlFor="in-region">{regionLabelIn(locale, p.homeCountry)}</label>
            {regions.length > 0 ? (
              <select
                id="in-region"
                value={p.homeRegion}
                onChange={(e) => p.onHomeRegionChange(e.target.value)}
              >
                <option value="">—</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="in-region"
                value={p.homeRegion}
                placeholder={s.regionPlaceholder}
                onChange={(e) => p.onHomeRegionChange(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field>
          <label htmlFor="in-first">{s.firstName}</label>
          <input
            id="in-first"
            value={name.first}
            onChange={(e) => changeName({ ...name, first: e.target.value })}
          />
        </Field>
        <Field>
          <label htmlFor="in-last">{s.lastName}</label>
          <input
            id="in-last"
            value={name.last}
            onChange={(e) => changeName({ ...name, last: e.target.value })}
          />
        </Field>
        <p className="text-muted text-[0.85rem]">{s.nameNote}</p>
      </Card>

      {p.txs.length > 0 && (
        <Card as="section" aria-label={s.useExisting}>
          <p>{s.existing(p.accounts.length, p.txs.length)}</p>
          <Button variant="primary" onClick={() => void p.onChoose("upload")}>
            {s.useExisting}
          </Button>
        </Card>
      )}

      <div
        /* Capture phase: any file picked inside means an upload is under way. */
        onChangeCapture={(e) => {
          if (
            (e.target as HTMLElement).tagName === "INPUT" &&
            (e.target as HTMLInputElement).type === "file"
          )
            setWaiting(true);
        }}
      >
        <Import
          entity={p.entity}
          onEntityChange={p.onEntityChange}
          busy={p.busy}
          problems={[]}
          onImport={p.onImport}
          onRefreshBank={p.onRefreshBank}
          onBeforeBankRedirect={() => p.onChoose("bank")}
          bankDefaultPsuType="personal"
        />
      </div>

      <Card as="section" aria-label={s.skipTitle}>
        <h2>{s.skipTitle}</h2>
        <p>{s.skipBody}</p>
        <Button onClick={() => void p.onChoose("none")}>{s.skipButton}</Button>
      </Card>
    </>
  );
}
