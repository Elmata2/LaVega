import { useState } from "react";
import type { AdvisorProfile, AdvisorProfileStore, scoreCapacity } from "@lavega/core";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import CardLink from "../components/ui/CardLink.js";
import { useAppLocale } from "../appLocale.js";
import type { View } from "../appRoutes.js";
import { intakeCopy, type AboutYouCopy } from "../copy/intake.js";
import { formatDate } from "../format.js";
import type { Locale } from "../locale.js";
import { profileRows, type Editor, type Row } from "../intake/aboutYouRows.js";
import { centsToInput, toCents } from "../intake/money.js";
import { useProfileCommit } from "../intake/useProfileCommit.js";
import { wizardCopy } from "../copy/wizard.js";
import CardPicker, { orderedCardIds } from "../intake/wizard/CardPicker.js";
import MultiTiles from "../intake/wizard/MultiTiles.js";

export type AboutYouProps = {
  /** What the vault holds; null when it holds nothing readable. */
  store: AdvisorProfileStore | null;
  /** True when a stored profile exists but no longer decodes. */
  corrupt?: boolean;
  /** Computed from the same inputs the intake uses; shown, never stored. */
  capacity: ReturnType<typeof scoreCapacity>;
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onNavigate: (view: View) => void;
  /** Today, `YYYY-MM-DD`. */
  asOf?: string;
  /** The write time for the store, injectable for tests. */
  now?: () => string;
};

/** Every fact the profile holds, with where it came from and when, and a way
 *  to change or remove each one. Capacity is listed but is not a fact: it is
 *  worked out each time and cannot be edited. */
export default function AboutYou(props: AboutYouProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale].aboutYou;
  const now = props.now ?? (() => new Date().toISOString());
  const asOf = props.asOf ?? now().slice(0, 10);
  const { store, update, saveFailed } = useProfileCommit(props.store, props.onSave, now);
  const [editing, setEditing] = useState<string | null>(null);

  const rows = profileRows(store.current, { c, locale, asOf });
  const hasData = rows.length > 0;

  async function removeRow(row: Row) {
    await update((p: AdvisorProfile) => row.remove(p));
  }

  async function redoRow(row: Row) {
    if (row.redo === undefined) return;
    const redo = row.redo;
    if (await update((p: AdvisorProfile) => redo(p))) props.onNavigate("intake");
  }

  return (
    <div aria-label={c.ariaLabel} role="region" className="max-w-[48rem]">
      {props.corrupt && (
        <p role="status" className="text-warn">
          {c.corruptNotice}
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="text-warn">
          {c.saveFailed}
        </p>
      )}

      <Card as="section" aria-label={c.title}>
        <h2>{c.title}</h2>
        <p className="text-muted text-[0.85rem]">{c.intro}</p>
      </Card>

      {!hasData ? (
        <Card as="section" aria-label={c.empty.title} data-testid="about-you-empty">
          <h3 className="m-0">{c.empty.title}</h3>
          <p>{c.empty.body}</p>
          <Button variant="primary" onClick={() => props.onNavigate("intake")}>
            {c.empty.start}
          </Button>
        </Card>
      ) : (
        <Card as="section" aria-label={c.columns.field}>
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="about-you-table">
              <thead>
                <tr>
                  <th scope="col">{c.columns.field}</th>
                  <th scope="col">{c.columns.value}</th>
                  <th scope="col">{c.columns.source}</th>
                  <th scope="col">{c.columns.date}</th>
                  <th scope="col">{c.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <FactRow
                    key={row.key}
                    row={row}
                    c={c}
                    locale={locale}
                    editing={editing === row.key}
                    onEdit={() => setEditing(row.key)}
                    onCancel={() => setEditing(null)}
                    onRemove={() => void removeRow(row)}
                    onRedo={() => void redoRow(row)}
                    onApply={async (fn) => {
                      if (await update(fn)) setEditing(null);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {hasData && (
        <Card as="section" aria-label={c.capacity.label} data-testid="about-you-capacity">
          <h3 className="m-0">{c.capacity.label}</h3>
          <p>
            {props.capacity.score === null
              ? c.capacity.unknown
              : c.capacity.value(props.capacity.score)}{" "}
            <span className="text-muted text-[0.85rem]">({c.capacity.computed})</span>
          </p>
          <p className="text-muted text-[0.85rem]">{c.capacity.note}</p>
        </Card>
      )}
    </div>
  );
}

function FactRow({
  row,
  c,
  locale,
  editing,
  onEdit,
  onCancel,
  onRemove,
  onRedo,
  onApply,
}: {
  row: Row;
  c: AboutYouCopy;
  locale: Locale;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onRedo: () => void;
  onApply: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<void>;
}) {
  const label = c.sectionLabels[row.section];
  return (
    <tr data-testid={`fact-${row.key}`}>
      <th scope="row">
        {label}
        {row.detail && <span className="block text-muted text-[0.85rem]">{row.detail}</span>}
      </th>
      <td>
        {editing && row.editor ? (
          <EditorForm
            editor={row.editor}
            c={c}
            locale={locale}
            label={c.actionFor(c.edit, label, row.detail)}
            onCancel={onCancel}
            onApply={onApply}
          />
        ) : (
          // Text, never markup: what the user typed stays literal.
          <span>{row.value}</span>
        )}
      </td>
      <td>{c.sources[row.source]}</td>
      <td>{formatDate(locale, row.at)}</td>
      <td>
        {editing ? null : (
          <span className="flex gap-3">
            {row.editor ? (
              <CardLink aria-label={c.actionFor(c.edit, label, row.detail)} onClick={onEdit}>
                {c.edit}
              </CardLink>
            ) : row.redo ? (
              <CardLink aria-label={c.actionFor(c.redo, label, row.detail)} onClick={onRedo}>
                {c.redo}
              </CardLink>
            ) : null}
            <CardLink
              variant="danger"
              aria-label={c.actionFor(c.remove, label, row.detail)}
              onClick={onRemove}
            >
              {c.remove}
            </CardLink>
          </span>
        )}
      </td>
    </tr>
  );
}

function EditorForm({
  editor,
  c,
  locale,
  label,
  onCancel,
  onApply,
}: {
  editor: Editor;
  c: AboutYouCopy;
  locale: Locale;
  label: string;
  onCancel: () => void;
  onApply: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<void>;
}) {
  const [text, setText] = useState(() => initialText(editor));
  const [high, setHigh] = useState(() =>
    editor.kind === "range" ? centsToInput(editor.initial.highCents) : "",
  );

  const [picked, setPicked] = useState<readonly string[]>(() =>
    editor.kind === "multi" || editor.kind === "cards" ? editor.initial : [],
  );

  const apply = (): ((p: AdvisorProfile) => AdvisorProfile) | null => {
    switch (editor.kind) {
      case "multi":
        return picked.length === 0 ? null : (p) => editor.apply(p, [...picked]);
      case "cards":
        return picked.length === 0 ? null : (p) => editor.apply(p, orderedCardIds(picked));
      case "euros": {
        const cents = toCents(text);
        return cents === null ? null : (p) => editor.apply(p, cents);
      }
      case "months": {
        const n = Number(text);
        return text.trim() === "" || !Number.isFinite(n) || n < 0
          ? null
          : (p) => editor.apply(p, n);
      }
      case "years": {
        const years = text
          .split(/[,\s]+/)
          .filter((x) => x !== "")
          .map(Number);
        return years.every((y) => Number.isInteger(y) && y >= 1900 && y <= 2200)
          ? (p) => editor.apply(p, years)
          : null;
      }
      case "text":
        return (p) => editor.apply(p, text.trim());
      case "range": {
        const low = toCents(text);
        const hi = toCents(high);
        return low === null || hi === null || hi < low
          ? null
          : (p) => editor.apply(p, { lowCents: low, highCents: hi });
      }
      case "choice":
        return (p) => editor.apply(p, text);
    }
  };
  const next = apply();

  return (
    <form
      aria-label={label}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (next) void onApply(next);
      }}
    >
      {editor.kind === "multi" ? (
        <MultiTiles<string>
          label={label}
          options={editor.options.map((o) => ({ value: o.id, label: o.label }))}
          selected={picked}
          onToggle={(k) =>
            setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))
          }
        />
      ) : editor.kind === "cards" ? (
        <CardPicker copy={wizardCopy[locale]} label={label} picked={picked} onChange={setPicked} />
      ) : editor.kind === "choice" ? (
        <select
          aria-label={c.editors.choice}
          value={text}
          onChange={(e) => setText(e.target.value)}
        >
          {editor.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : editor.kind === "text" ? (
        <textarea
          aria-label={c.editors.worries}
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
      ) : editor.kind === "range" ? (
        <>
          <input
            type="number"
            min={0}
            step="any"
            aria-label={c.editors.low}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <input
            type="number"
            min={0}
            step="any"
            aria-label={c.editors.high}
            value={high}
            onChange={(e) => setHigh(e.target.value)}
          />
        </>
      ) : editor.kind === "years" ? (
        <input
          type="text"
          aria-label={c.editors.childYears}
          placeholder={c.editors.childYearsHint}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <input
          type="number"
          min={0}
          step="any"
          aria-label={editor.kind === "months" ? c.editors.months : c.editors.euros}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <Button type="submit" variant="primary" disabled={next === null}>
        {c.save}
      </Button>
      <Button type="button" onClick={onCancel}>
        {c.cancel}
      </Button>
    </form>
  );
}

function initialText(e: Editor): string {
  switch (e.kind) {
    case "euros":
      return centsToInput(e.initial);
    case "months":
      return String(e.initial);
    case "years":
      return e.initial.join(", ");
    case "text":
      return e.initial;
    case "range":
      return centsToInput(e.initial.lowCents);
    case "choice":
      return e.initial;
    case "multi":
    case "cards":
      return "";
  }
}
