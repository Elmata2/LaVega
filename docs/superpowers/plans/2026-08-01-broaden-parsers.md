# LaVega — Plan 2: Broaden the importers (all banks + MT940) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Import **every** LaVega owner's bank export — not just ING — into the one aggregated per-entity overview, with **real balances** where the format carries them. Banks: ING (done), ABN AMRO, Rabobank, Knab, NN, Revolut, American Express, Trading 212. Formats: bank CSV profiles + MT940/.STA (CAMT.053 deferred to a follow-up — all target banks export CSV and/or MT940).

**Architecture:** Port the reference `Kasoverzicht.html`'s parser suite into `@lavega/core` (pure), driven by a header-signature profile table + a format dispatcher; rewrite `FileImport` to call the dispatcher (ING routes through the generic engine, identical output). Balances from MT940/ABN flow into the existing null-aware `consolidate` → the overview shows real totals instead of all-"onbekend".

**Tech stack:** TypeScript, Vitest. Reuse the already-ported `splitRows`, `parseAmount` (Dutch thousands-sep), and the `tx.id` djb2 hash. **CAMT.053 (XML) is out of scope for this plan** — deferred (needs an XML parser; no target bank requires it).

**Reference (port from):** `/private/tmp/claude-501/-Users-alexandersteunenberg-Desktop-My-Code/47421598-9580-457e-84d7-37a70c253546/scratchpad/finntell_archief_extract/kasoverzicht/Kasoverzicht.html` — `parseDate` (346, full multi-format), `parseMT940` (398), profile table (486-500), `parseABN` (523), `parseGenericCSV` (549), `parseAny` (618).

## Global Constraints

- **`packages/core` stays I/O-free** (CSV + MT940 are pure string parsing — no XML/DOM/fs/fetch). TypeScript, ESM.
- **Preserve `tx.id` compatibility** — every parser outputs `Omit<Tx,"id">[]` with the same field conventions; `assignTxIds` is unchanged. Amounts negative for outflow; dates ISO `YYYY-MM-DD`.
- **Don't break ING** — after the FileImport rewrite, an ING CSV must produce byte-identical txs/account to today (regression test).
- Balance conventions: MT940/ABN closing balance → `Account.balance` (real number); CSV-only accounts stay `balance: null` ("onbekend").
- Reuse existing `parseAmount`/`splitRows`; **extend `parseDate`** to the reference's full multi-format version (346-360: `YYYYMMDD`, `DD-MM-YYYY`, `YYYY-MM-DD`, MT940 `YYMMDD`, etc.).

---

### Task 1: Generic CSV engine + bank profile table (ABN/Rabobank/Knab/Revolut/Amex/Trading 212)

**Port:** `parseGenericCSV` (549-615), the `profiles` array (486-500), `headerIndex`/`pick` column mapping (502-516), `parseABN` (523-547), and extend `parseDate` (346-360).

- Create a profile-driven `parseBankCsv(text, fallbackAccountKey): { accounts, txs, profile }` in `@lavega/core` that: detects the bank by header signature (the `test:` predicates), maps columns via `headerIndex`/`pick`, and parses rows → `Omit<Tx,"id">[]`. ABN AMRO (TAB, no header, 8 cols → carries a closing **balance**) is a special branch, port `parseABN`.
- Fold **ING** into this engine as one profile (its `test:h.includes('af bij')&&h.includes('bedrag (eur)')`), so `parseBankCsv` replaces the standalone `parseIngCsv` path. Keep `parseIngCsv` exported as a thin wrapper (or delete it and update callers in Task 3) — decide during implementation, but the ING output must stay identical.
- **TDD:** synthetic fixtures per bank (Rabobank CSV, Knab, Revolut, Amex — incl. its positive-expense "flip" option, Trading 212 cash-only, ABN TAB-no-header with balance) asserting concrete parsed values. Reuse the existing ING fixture to prove no regression.
- Commit: `feat(core): profile-driven bank CSV engine (ABN/Rabo/Knab/Revolut/Amex/T212)`.

### Task 2: MT940 / .STA parser (with balances)

**Port:** `parseMT940` (398-443) + the MT940 `YYMMDD` branch of `parseDate`.

- `parseMt940(text): { accounts, txs }` — split on `:20:` blocks, `:25:` → account (IBAN), `:61:` → transactions (date, C/D sign, amount), `:86:` → description; closing balance (`:62F:`/`:60F:`) → `Account.balance` (real number). Pure string parsing, no deps.
- **TDD:** a synthetic MT940 fixture (2-3 txs, a closing balance) asserting the txs, the DBIT/CRDT signs, and the extracted balance. Confirm a debit `:61:` → negative amount.
- Commit: `feat(core): MT940/.STA parser with closing balance`.

### Task 3: Format dispatcher + FileImport rewrite (route all formats)

**Port:** `parseAny` (618-646) → a `parseBankFile(filename, text): { accounts, txs, source, problems }` that detects: MT940 (`/:20:/` + `/:61:/`) → `parseMt940`; else CSV → `parseBankCsv`. (CAMT branch omitted — deferred; an XML input returns a clear `problems: ["CAMT.053 nog niet ondersteund"]`.)

- Rewrite `packages/adapters/src/banking/fileImport.ts` to call `parseBankFile` (replacing the ING-only sniff), preserving the `BankAccessAdapter`/`BankResult` shape, the `entity` field on created accounts, and the unknown-format `problems` path.
- **TDD:** FileImport routes an ING CSV, a Rabobank CSV, and an MT940 correctly (account + txs + source label + balance where present); unknown/XML → `problems` populated, no throw. **ING regression: identical output to before.**
- Commit: `feat(adapters): FileImport routes all CSV profiles + MT940`.

### Task 4 (DEFERRED — follow-up, not this plan): CAMT.053 XML

Port `parseCAMT` (445) once an XML parsing approach that works in both Node (tests) and browser is chosen (`fast-xml-parser`, or DOMParser + a node shim). No target bank requires it, so it's a later add.

## Self-Review checklist

- ING output unchanged (regression test green). All profiles produce correct signs/dates/amounts (reuse `parseAmount`'s thousands-sep handling). MT940/ABN balances populate `Account.balance`; CSV-only stays null. `core` I/O-free. `tx.id` unchanged → cross-format + re-import dedup still holds. No CAMT/XML dep pulled in.

## Notes

- The overview already consolidates + renders balances (null → "onbekend"); no UI change needed for this plan — real balances appear automatically once MT940/ABN imports land.
- An **Accounts/entity view** (reassign an account's entity after import, vs the per-import `entity` field) is a separate follow-up — nice for multi-BV reorganizing, not required to import-all + see the aggregated overview.
