# Advisor Pivot: Archive and Profile Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the business-only side of LaVega behind one switch, and ship a resumable profile intake (steps 0 to 3) that stores a sourced, versioned profile in the encrypted vault and ends in one computed number, "Your room each month".

**Architecture:** Pure logic lives in a new `packages/core/src/advisor/` folder (Effect Schema for the profile, plain pure functions for inference, room, capacity and tolerance, each returning proposals that carry evidence ids). The vault gets four sections (`profile`, `plan`, `learning`, `events`), each with its own merge strategy; this plan builds the scaffolding and fills `profile` (last 10 versions inside it). `apps/web` gets one archive module, an intake view, a "What LaVega knows about you" view and an Overzicht card; every string goes through typed NL+EN copy.

**Tech Stack:** TypeScript, Effect 4 (`effect@4.0.1`: `Schema`, `Predicate`), React, vitest (`@effect/vitest` for Effect code), pnpm/turbo, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-21-advisor-pivot-intake-design.md` (approved; section 10 overrides anything earlier). Read both it and `AGENTS.md` first.

## Global Constraints

- New TypeScript logic uses Effect 4 (Schema, TaggedError, Context.Service, DateTime, Predicate); no hand-written predicates; no `Date.now()` in new core code (take `asOf: string` as a parameter, as `detectSubscriptions` does). Read `repos/effect/LLMS.md` before writing Effect code.
- All copy NL and EN, typed-complete (`Record<Locale, T>`), in copy modules under `apps/web/src/copy/`; no Dutch outside copy modules; return a KIND from logic, render from copy (`docs`: lavega_i18n_boundary). New copy modules join `copy/parity.test.ts`.
- Local-first: the profile lives in the vault; nothing new on the server. The server never receives the profile.
- Every number shown is computed in code and covered by tests; the AI never produces or changes one. No AI call is added by this plan.
- Allowed: calculations on the user's numbers, general explanation, public facts. Not allowed anywhere in copy: naming a fund/product/provider as right for the user, "invest EUR X a month", "put X% in equities", "people with your profile usually ...". The banned-word list is ONE list, `packages/core/src/advice/language.ts`, created in Task 2; every copy test in this plan (Task 8 and any later scan) imports it and does not keep a local list.
- Public facts (gift-tax figures, box 3, Nibud numbers) are never quoted from this plan or from copy directly. Each goes through `PublicFact` with a `verifiedOn` date (defined in Task 2); a fact without `verifiedOn` fails the build check and cannot be shown. This plan quotes none.
- Occurrence bar (DEVIATION from spec 4.3, owner to confirm): follow the code's `CADENCE_BANDS` (`subscriptions.ts:338`): 3 occurrences for monthly and bi-monthly streams, 2 for quarterly, half-yearly and yearly (a yearly insurance must not vanish). Spec 4.3 says 3 flat. Nothing is proposed from fewer than 60 days of history (the card falls back to the question). Children are never inferred from absence of a signal; kinderbijslag or childcare payments only prompt "Do you have children?", and the answer is always asked.
- Every profile field carries `value`, `source: derived | confirmed | stated`, `at` (ISO date) and, for `derived`, evidence ids. An unconfirmed inferred fact is shown as a guess, never treated as fact.
- Month math: one tested helper module `packages/core/src/advisor/months.ts` (Effect `DateTime`) is the only place that adds/subtracts months or compares to 12 months (`previousMonths`, `monthsBetween`, `isoMonth`). Room, `riskDue` and coverage use it; no `new Date` month arithmetic elsewhere in the plan's code.
- Fixed costs (one definition everywhere): the housing line plus recurring outgoing streams plus subscriptions. `proposeFixedCosts`, capacity (`fixedCostsMonthlyCents`), `bufferMonths` and the later plan buffer all use it. Debt repayments are not fixed costs.
- Room (spec 10.2): last three FULL calendar months; net = incoming minus outgoing; "Eigen overboeking" and own-account transfers excluded both ways; debt repayments count as spending; one-offs and irregular income included as they fell; foreign currency follows the existing euro-conversion setting; headline = middle month, range = lowest and highest; fewer than 3 full months: say so, use what exists, never extrapolate. Personal scope only (spec 10.1): accounts assigned to a business entity are excluded; no entities set means all accounts count.
- Capacity (spec 10.3): 1 to 5 from four inputs each scored 0 to 2 and summed: buffer in months of fixed costs (<1, 1-3, >3), room (negative, 0-10% of income, >10%), debt payments share of income (>30%, 10-30%, <10%), nearest goal horizon (<3 y, 3-10, >10). Tolerance also 1 to 5. Disagreement flagged when they differ by 2 or more. All thresholds in ONE table.
- Archive hides UI only; scope is NOT forced globally (ruling): room/income/capacity use personal-scope accounts (10.1), forecast/buffer/Optimalisatie keep the account set they use today (10.7); only the scope-switch UI is hidden; stored module/widget ids naming archived ids are ignored, not errors; deep links to archived routes land on Overzicht; server routes stay deployed.
- No special-category data in the intake (health, religion).
- Motion, if any: restrained, per `emil-design-eng`/`animate`. Check them before writing any CSS transition.
- Commit steps below say "stage (owner commits)": agents run `git add` only, never `git commit` or `git push`.
- Verify commands (repo root): `pnpm --filter @lavega/core test`, `pnpm --filter @lavega/web test`, `pnpm --filter @lavega/adapters test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`. If a package filter name differs, read its `package.json` `name`.

## Review Focus

Failure modes (six) the spec implies that no single task's happy path exercises (each is pinned by a test in the owning task):

1. A user with zero transactions or fewer than 60 days of data: every card must fall back to the question, room must say "not enough data", no NaN or empty proposals (Tasks 3, 4, 6).
2. A month with zero income or negative income-to-spend (division by zero in capacity percentages; room negative) (Tasks 4, 5).
3. Re-import or sync that changes the evidence behind a "Not mine" fact: the removed fingerprint must stay suppressed until the evidence changes, and must NOT suppress a different stream (Tasks 2, 3).
4. Resume mid-intake after a lock/reload, a vault from before this change (no `profile` section), and a write racing the previous write (newest wins, versions capped at 10) (Tasks 2, 6).
5. Foreign-currency rows with no rate: excluded and counted, shown on the card (Task 4).
6. Archived ids in stored module/widget preferences, `/app/facturen` deep links, and a user who has business entities set: no crash, personal scope only, data untouched (Tasks 1, 4).

---

## File Structure

Core (new folder `packages/core/src/advisor/`, exported from `packages/core/src/index.ts`):
- `profile.ts` Schema for the profile, `Field` wrapper, version-keeping helpers.
- `evidence.ts` `Proposal<T>` type, evidence fingerprint, suppression filter.
- `scopePersonal.ts` the personal-scope account/tx selector used by room, capacity and inference.
- `incomeStreams.ts`, `housingProposal.ts`, `fixedCosts.ts`, `debts.ts`, `savings.ts`, `childSignal.ts` block-1 inference.
- `packages/core/src/advice/language.ts` the one NL and EN banned advice-language list (Task 2); `advisor/publicFact.ts` the `PublicFact` schema (Task 2); `advisor/vaultSections.ts` section names and merge functions (Task 2).
- `room.ts` room calculation.
- `thresholds.ts` the single threshold table; `capacity.ts`; `riskScale.ts` (items, scoring, source record); `knowledge.ts` (questions, experience).
Adapters: `packages/adapters/src/storage/encryptedStorage.ts` gets `getProfile`/`putProfile` for the `profile` section, and the scaffolding accessors for `plan`, `learning` and `events` (Task 2).
Web: `apps/web/src/archive.ts`; `apps/web/src/copy/intake.ts`; `apps/web/src/intake/` (state, steps); `apps/web/src/views/Intake.tsx`; `apps/web/src/views/AboutYou.tsx`; `apps/web/src/components/blocks/RoomCard.tsx`.

Order differs from the brief in one place only: the copy cleanup that mentions the intake (landing, onboarding text) waits for Task 9, because it must point at a thing that exists. Task 1 removes pointers to archived features only. Reason: pointing copy at the intake before it ships would be a dead end.

---

### Task 1: Archive switch, redirects, copy cleanup

**Files:**
- Create: `apps/web/src/archive.ts`, `apps/web/src/archive.test.ts`
- Modify: `apps/web/src/appRoutes.ts` (viewFromPathname), `apps/web/src/components/moduleRegistry.tsx` (`enabledModules`, `enabledWidgets`, `normaliseWidgets`, `navModules`), `apps/web/src/App.tsx` (initial scope forced to personal, view rendering for archived views at ~1731-1783), `apps/web/src/components/TopBar.tsx` (scope switch hidden), `apps/web/src/agent/tabContext.ts` (remove `valuta`, `belasting`, `facturen` cases at ~267-338), `apps/web/src/views/Overzicht.tsx` (Positie/Btw/Facturen widgets), `apps/web/src/views/Koppelingen.tsx` (invoice-address card + forwarding guide), `apps/web/src/views/Profiel.tsx` (scopeSection entity classifier hidden), `apps/web/src/copy/shell.ts`, `apps/web/src/landingCopy.ts`, `apps/server/src/agent/prompts/` (delete `facturen.md`, `belasting.md`, `valuta.md`; KEEP `facturen-extract.md`: the extract-invoice route stays deployed and `prompts.test.ts` loops over it; edit `overview.md` line 2 to drop "Belasting, Facturen" from the tab list; edit the `_base.md` sentence at line ~5 ("land verschillen — belasting vooral — bepaalt het land in de context welke ...") only if the read shows it points at the Belasting tab; the word "belasting" in the general tax-rules sense stays), `apps/server/src/agent/prompts.ts` (tab allowlist if any)
- Test: `apps/web/src/archive.test.ts`, `apps/web/src/appRoutes.test.ts`, `apps/web/src/module-grid.test.tsx`, `apps/server/src/agent/prompts.test.ts`, `apps/web/src/agent/tabContext.test.ts`

**Interfaces:**
- Produces:
  - `export const ARCHIVE_BUSINESS = true` (the ONE switch)
  - `export const ARCHIVED_VIEWS: readonly View[]` = `["facturen","belasting","valuta"]` when switch on, `[]` off
  - `export const ARCHIVED_WIDGETS: readonly WidgetId[]` = `["positie","facturen-open","btw-stand"]` when on
  - `export function isArchivedView(v: string): boolean`, `export function isArchivedWidget(id: string): boolean`
  - `export const SHOW_SCOPE_SWITCH: boolean` (false when archived), `export const SHOW_INVOICE_FORWARDING: boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// archive.test.ts
test("switch on archives facturen, belasting, valuta", () => {
  expect(ARCHIVED_VIEWS).toEqual(["facturen", "belasting", "valuta"]);
  expect(isArchivedView("belasting")).toBe(true);
  expect(isArchivedView("forecast")).toBe(false);
});
// appRoutes.test.ts additions
test("deep link to an archived route lands on overview", () => {
  expect(viewFromPathname("/app/facturen")).toBe("overview");
  expect(viewFromPathname("/app/valuta/")).toBe("overview");
});
// module-grid.test.tsx additions
test("stored prefs naming archived ids are ignored, not an error", () => {
  expect(enabledModules(["overview", "facturen", "belasting", "forecast"])).toEqual(["overview", "forecast"]);
  expect(enabledWidgets({ on: ["btw-stand", "aandacht"], seen: ["btw-stand", "aandacht"] })).toEqual(["aandacht"]);
});
test("default modules and widgets exclude archived ids", () => {
  expect(DEFAULT_MODULES.some(isArchivedView)).toBe(false);
  expect(DEFAULT_WIDGETS.some(isArchivedWidget)).toBe(false);
});
```
Also: a prompts test that `loadChatPrompt("facturen" | "belasting" | "valuta")` falls back to the two charters and `loadTaskPrompt("facturen-extract")` still loads; `overview.md` does not contain the exact text "Belasting, Facturen"; and a `tabContext` test that those three tabs now return the default/empty context (no throw).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @lavega/web test -- archive appRoutes module-grid` and `pnpm --filter @lavega/server test -- prompts`
Expected: FAIL (`archive.ts` missing; routes still resolve).

- [ ] **Step 3: Implement** `archive.ts` as above. In `viewFromPathname`, a resolved view that `isArchivedView` returns `"overview"` (App.tsx's existing effect then rewrites the URL to `/app`). Filter archived ids inside `enabledModules`, `enabledWidgets`, `normaliseWidgets` and the `DEFAULT_*` derivations (keep entries in `MODULES`/`WIDGETS` so the one-line switch restores them; do not delete component files, their existing tests keep passing because they mount components directly). In `App.tsx`: do NOT change the scope state or how data is scoped (ruling). Only stop rendering the archived view branches and hide the switch. Room/income/capacity do their own personal-scope selection in core (Tasks 3, 4); forecast, buffer and Optimalisatie keep their inputs. `TopBar`/`Koppelingen`/`Profiel` hide the scope switch, invoice-address card/forwarding guide and entity classifier behind `SHOW_*` constants. Overzicht skips the three archived widgets.
- [ ] **Step 4: Copy cleanup (pointers to archived features only).** In `copy/shell.ts` (NL and EN trees together), `landingCopy.ts` and server prompts, delete or reword sentences that send the user to Facturen/Belasting/Valuta/Grens/entities. Do not add intake mentions yet. Keep `nav.moduleLabels` keys (typed by `ModuleId`).
- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @lavega/web test && pnpm --filter @lavega/server test -- prompts agent-routes && pnpm typecheck && pnpm lint`
Expected: PASS. Existing `facturen-*`, `belasting-*`, `grens-ui`, `valuta-ui`, `koppelingen` tests still pass or are updated only where they asserted the now-hidden card (list each change in the report).
- [ ] **Step 6: Existing tests that change (list each in the report with the change):** `scope.test.ts` and `scope-restore.test.tsx` (switch UI absent; pure helpers in `scope.ts` stay and keep their tests); `grens-ui.test.tsx`, `belasting-ui.test.tsx`, `belasting-country.test.tsx`, `valuta-ui.test.tsx`, `facturen-*.test.tsx`, `forwardingGuide-ui.test.tsx` (mount components directly: expected unchanged; if one navigates through `App`, change it to assert the redirect); `koppelingen.test.tsx` (invoice-address card assertions removed or flipped to absent); `Profiel.test.tsx` (scopeSection absent); `overzicht.test.ts`/`module-grid.test.tsx` (default widget lists); `App.test.tsx`/`Root.test.tsx`/`shell.english.test.tsx`/`NavBar.test.tsx` (nav labels). Review Focus pin: a user with business entities set still opens, vault data unchanged, forecast figures identical to before; `/app/belasting` ends at `/app`.
- [ ] **Step 7: Stage (owner commits):** `git add apps/web apps/server`

---

### Task 2: Profile Schema, vault section, versioning

**Files:**
- Create: `packages/core/src/advisor/profile.ts`, `packages/core/src/advisor/evidence.ts`, `packages/core/src/advisor/profile.test.ts`, `packages/core/src/advisor/vaultSections.ts` (+ test), `packages/core/src/advisor/publicFact.ts` (+ test), `packages/core/src/advice/language.ts` (+ test)
- Modify: `packages/core/src/index.ts` (export), `packages/adapters/src/storage/encryptedStorage.ts` (`VaultData.profile`, `VaultData.plan`, `VaultData.learning`, `VaultData.events`; interface + impl), `packages/adapters/src/storage/encryptedStorage.test.ts`, `apps/web/src/backup.ts` only if it enumerates vault keys (check)
- Test: `packages/core/src/advisor/profile.test.ts`, `packages/adapters/src/storage/encryptedStorage.test.ts`

**Interfaces:**
- Produces (core):
  - `Schema` `FieldSource = Literal("derived","confirmed","stated")`
  - `Field<A>(value: Schema<A>)` schema: `{ value: A, source: FieldSource, at: string /*ISO date*/, evidence?: string[] }` with a refinement: `evidence` required non-empty iff `source === "derived"`.
  - `AdvisorProfile` Schema.Class with sections: `household`, `children`, `incomeStreams`, `housing`, `fixedCosts`, `debts` (`Debt`), `savings`, `goals` (`Goal`), `buffer`, `risk` (`{ score: 1..5, answers, scaleId, at }`), `knowledge`, `experience: "beginner"|"some"|"experienced"`, `worries`; plus `removed: string[]` (evidence fingerprints) and `intake: { blocksDone: number /*0..3*/, step0: "bank"|"upload"|"none"|null }`. Capacity is NOT a field (computed, never stored).
  - `Goal` (spec 4.7, the only goal schema; the plan adds no fields), as the value of a `Field`: `{ id, purpose, kind: "general" | "child", childId?, targetCents, targetDate, priority: "flexible" | "important" | "must", plannedMonthlyCents?, startingBalanceCents?, accountRefs: Array<{ kind: "bank" | "broker"; id: string }> }`. A refinement: `childId` present iff `kind === "child"`.
  - `Debt` (spec 4.7): `{ id, lender, monthlyCents, balanceCents?, ratePct?, source, at }`.
  - `emptyProfile(): AdvisorProfile`
  - `AdvisorProfileStore = { current: AdvisorProfile; versions: AdvisorProfile[] /*newest first, max 10*/ }`
  - `commitProfile(store: AdvisorProfileStore, next: AdvisorProfile): AdvisorProfileStore` pushes the previous `current` onto `versions`, trims to 10, keeps the newest write.
  - `fingerprint(evidenceIds: readonly string[]): string` (stable: sorted, `hash()` from `hash.ts`)
  - `removeDerived(profile, fp)`, `isSuppressed(profile, fp): boolean`
- Produces (vault sections, `vaultSections.ts`): `VaultSection = "profile" | "plan" | "learning" | "events"` and one merge function per section, used when two devices write:
  - `profile`: newest write wins; last 10 versions kept (`commitProfile`).
  - `plan`: `PlanPreferences` newest write wins; 13 monthly snapshots (keyed by month, oldest trimmed). Record types are filled by the plan step.
  - `learning`: concept state, newest write wins per concept id. Record type is filled by the AI layer.
  - `events`: append-only, unique ids, union merge across devices: `ExplanationEvent`, `OutcomeEvent`, `PlanEvent`. `mergeEvents(a, b)` unions by id; counters are never stored. Event record types are filled by the plan and AI steps; this task defines the envelope `{ id, kind, at }` and the merge.
- Produces (shared with every later step):
  - `packages/core/src/advice/language.ts`: `ADVICE_LANGUAGE`, the single NL and EN banned-language list (at least "best", "beste", "recommend", "we raden aan", "safe"/"veilig" as a quality of an option, "good deal", "typical", "typisch", "people / households like you" and Dutch forms, buy/sell/hold and "should" with their Dutch forms "kopen", "verkopen", "aanhouden", "moeten", imperatives aimed at instruments, ticker and ISIN patterns) and `findAdviceLanguage(text, locale): string[]`. Task 8 copy tests, the plan templates and tests and the AI validators all import it; nothing keeps its own list.
  - `packages/core/src/advisor/publicFact.ts`: `PublicFact { id, textKey, value, source, sourceUrl, verifiedOn, verifiedBy }` and `assertShowable(fact)`; a fact with no `verifiedOn` fails a build check and cannot be shown. Every public fact (gift-tax figures, box 3, Nibud numbers) goes through it.
- Produces (adapters): `VaultStorage.getProfile(): Promise<AdvisorProfileStore | null>` (null on a legacy vault), `putProfile(s: AdvisorProfileStore): Promise<void>`; accessors `getSection(name)` / `putSection(name, value)` for `plan`, `learning`, `events` (events through `appendEvents`, which merges by union).

- [ ] **Step 1: Write failing tests**

```ts
test("derived field without evidence is rejected; confirmed without evidence is fine", ...)
test("commitProfile keeps newest as current and caps versions at 10", () => {
  let s = { current: emptyProfile(), versions: [] };
  for (let i = 0; i < 12; i++) s = commitProfile(s, withWorries(`w${i}`));
  expect(s.current.worries?.value).toBe("w11");
  expect(s.versions).toHaveLength(10);
  expect(s.versions[0].worries?.value).toBe("w10");
});
test("fingerprint is order-independent and differs when evidence changes", ...)
test("removed fingerprint suppresses the same evidence, not a changed one", () => {
  const p = removeDerived(emptyProfile(), fingerprint(["a", "b", "c"]));
  expect(isSuppressed(p, fingerprint(["c", "b", "a"]))).toBe(true);
  expect(isSuppressed(p, fingerprint(["a", "b", "c", "d"]))).toBe(false);
});
test("Schema round-trips through JSON decode (vault blob)", ...)
// encryptedStorage.test.ts
test("legacy vault without a profile section returns null; put then get round-trips; survives lock/open", ...)
test("mergeEvents unions two devices' events by id and is idempotent; plan and learning sections merge newest-wins as specified", ...)
test("Goal: childId required iff kind is child; accountRefs accepts bank and broker refs; Debt rejects a missing lender or monthlyCents", ...)
test("ADVICE_LANGUAGE flags 'beste', 'we raden aan', 'people like you', 'kopen'; a PublicFact without verifiedOn is not showable", ...)
test("two rapid puts: the second wins (enqueueWrite ordering)", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/core test -- advisor/profile` and `pnpm --filter @lavega/adapters test -- encryptedStorage`. Expected: FAIL.
- [ ] **Step 3: Implement** the Schema in `profile.ts` (Schema.Class / Schema.Struct per AGENTS.md; decode with `Schema.decodeUnknownSync` at the vault boundary, wrapped in a `Schema.TaggedError` `ProfileDecodeError`). Vault getter/setter copy the `fxHistory` pattern at `encryptedStorage.ts:462-475` (optional `VaultData` field, `enqueueWrite`, `persist`). A decode failure on read returns `null` and does not delete the stored blob.
- [ ] **Step 4: Run to verify pass**, plus `pnpm typecheck`.
- [ ] **Step 5: Review Focus pin:** the legacy-vault and racing-write tests above; plus "backup export/restore keeps all four sections" in `apps/web/src/backup.test.ts` (restore a blob containing it, read it back).
- [ ] **Step 6: Stage (owner commits):** `git add packages/core packages/adapters apps/web/src/backup*`

---

### Task 3: Core inference functions (income, housing, fixed costs, debts, savings, child signal)

**Files:**
- Create: `packages/core/src/advisor/scopePersonal.ts`, `incomeStreams.ts`, `housingProposal.ts`, `fixedCosts.ts`, `debts.ts`, `savings.ts`, `childSignal.ts`, each with `*.test.ts`; `lenders.ts` (known-lender list)
- Modify: `packages/core/src/index.ts`
- Reuse, do not change: `detectScheduleStreams`, `detectSubscriptions` (`subscriptions.ts`), `proposeHousingCost` (`housing.ts`), `accountsInScope` (`entities.ts`), `categorize`, `accountType` (`balance.ts`), `ownAccounts`

**Interfaces:**
- Produces:
  - `export type Proposal<T> = { id: string; kind: T; evidence: string[] /*tx ids*/; fingerprint: string; confidence: "enough" | "thin" }` (in `evidence.ts`, Task 2 file; add here if absent)
  - `export type HistoryCoverage = { days: number; sufficient: boolean }` and `historyCoverage(txs: readonly Tx[]): HistoryCoverage` (sufficient = at least 60 days between first and last dated tx)
  - `personalView(accounts, txs, profiles): { accounts: Account[]; txs: Tx[] }` (personal scope; no profiles means all accounts)
  - `cleanTxs(txs, accounts, rules, own): Tx[]` — FIRST step of every proposer: drops txs where `categorize(tx, rules, own)` is `"Eigen overboeking"`, and `"Creditcard afbetaald"` when the card account is in the same account set. Needed because `detectScheduleStreams(txs, { asOf })` takes no rules/own and only hints own-money by name.
  - `proposeIncomeStreams(txs, opts: { asOf: string; rules: Rule[]; own: OwnAccounts; accounts: Account[] }): IncomeProposal[]` where `IncomeProposal = Proposal<{ label: string; monthlyCents: number; regularity: "regular" | "irregular" }>`. Regular = `detectScheduleStreams(cleanTxs(...), { asOf })` with `sign === 1`. Irregular = incoming totals per counterparty not in a stream, averaged over covered months (via `months.ts`).
  - `proposeHousing(txs, rules, own): HousingProposalCard | null` (wraps `proposeHousingCost`; adds evidence ids and fingerprint)
  - `proposeFixedCosts(txs, opts)` (same `cleanTxs` first) `: FixedCostProposal[]` = the housing line (from `proposeHousing`, as its own proposal of kind `housing`) plus outgoing `detectScheduleStreams` plus `detectSubscriptions`; excludes debt streams and never repeats a stream already used as the housing line, so nothing is counted twice. This is the one fixed-costs definition (Global Constraints).
  - `proposeDebts(txs, accounts, opts): DebtProposal[]` — outgoing streams whose party matches `lenders.ts` (DUO already in `INSTITUTIONS`; add DUO plus a short Dutch lender hint list: "lening", "krediet", "aflossing", and named consumer-credit issuers found in `categories.ts`), plus credit-card accounts with negative balance
  - `proposeSavings(accounts): SavingsProposal` (sum of positive balances on accounts whose `accountType(a)` is a savings type; EUR only per `isEurCurrency`)
  - `childSignal(txs, rules, own): ChildSignal | null` where `ChildSignal = { kind: "kinderbijslag" | "childcare"; evidence: string[] }`; never returns a count of children
  - every function returns `[]`/`null` when `!historyCoverage(txs).sufficient`

- [ ] **Step 1: Write failing tests (one file each; fixtures built inline with a `tx()` helper like `subscriptions.test.ts`):**

```ts
// incomeStreams.test.ts
test("salary 4 months -> one regular stream with the 4 tx ids as evidence", ...)
test("monthly with two occurrences -> not regular; appears as irregular if income", ...)
test("own transfer 'Eigen overboeking' is never income, including a mis-hinted one: counterparty not in OWN_MONEY_HINTS but IBAN of own account in description", ...)
test("quarterly and yearly streams are proposed with 2 occurrences (CADENCE_BANDS); a monthly stream with 2 is not", ...)
test("credit-card settlement is dropped from fixed costs when the card account is in scope, kept when it is not", ...)
test("under 60 days of history -> []", ...)
// housing: rent + 3 payments -> kind huur; no named housing -> null
// debts.test.ts
test("DUO outflow monthly x4 -> debt proposal labelled DUO", ...)
test("credit card account with balance -> debt proposal; savings account positive -> not a debt", ...)
// fixedCosts.test.ts
test("the housing line is included as one fixed-cost line; a stream also flagged as debt or already used as housing is not repeated", ...)
// childSignal.test.ts
test("kinderbijslag x3 -> signal; no signal for absence; never returns a number of children", ...)
// savings.test.ts
test("non-EUR savings pocket excluded and counted in `excluded`", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/core test -- advisor` Expected: FAIL.
- [ ] **Step 3: Implement** each function as a thin composition of the existing detectors (no new cadence logic). Evidence ids = the `Tx.id`s of the streams' transactions (DECISION: add `txIds: string[]` to `ScheduleStream` and `Subscription` in `subscriptions.ts`, filled where the member transactions are known in `fitMerchantStreams`/`detectScheduleStreams`; matching by stream key plus amount is rejected because one party can run two streams and a skipped cycle changes membership. Own test in `subscriptions.test.ts`: ids equal exactly the stream's member txs, and extras are excluded). Fingerprint = `fingerprint(evidence)` from Task 2. Every proposal filtered with `isSuppressed(profile, fp)` by the caller, not inside these pure functions.
- [ ] **Step 4: Run to verify pass** + `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Review Focus pin:** empty tx list, a single account with 59 vs 61 days, a stream whose evidence grows by one tx (new fingerprint, so a removed older one no longer suppresses it), and a business-entity account excluded by `personalView`.
- [ ] **Step 6: Stage (owner commits):** `git add packages/core/src`

---

### Task 4: Room calculation (spec 10.2)

**Files:**
- Create: `packages/core/src/advisor/room.ts`, `room.test.ts`, `months.ts`, `months.test.ts`
- Modify: `packages/core/src/index.ts`
- Reuse: `categorize`, `ownAccountNamed`, `toEur`, `ConversionMode`, `CREDIT_CARD_PAYMENT_CATEGORY`, `personalView`

**Interfaces:**
- Consumes: `personalView` (Task 3).
- Produces:
  - `months.ts`: `isoMonth(date: string): string`, `previousMonths(asOf: string, n: number): string[]` (newest first), `monthsBetween(from: string, to: string): number`, all via Effect `DateTime`
  - `export type RoomMonth = { month: string /*YYYY-MM*/; incomingCents: number; outgoingCents: number; netCents: number }`
  - `export type RoomResult = { kind: "computed"; months: RoomMonth[]; middleCents: number; middleIncomeCents: number /*median-month income; denominator for capacity shares*/; lowCents: number; highCents: number; partial: boolean /*fewer than 3 full months*/; excludedForeignCount: number } | { kind: "none"; reason: "no-data" | "no-full-month" } | { kind: "stated"; lowCents: number; highCents: number }`
  - `computeRoom(input: { txs: Tx[]; accounts: Account[]; profiles: EntityProfile[]; rules: Rule[]; own: OwnAccounts; asOf: string; mode: ConversionMode; fxHistory: Record<string, Record<string, number>> }): RoomResult`
  - `roomFromStated(income: { lowCents: number; highCents: number }, spend: { lowCents: number; highCents: number }): RoomResult` (kind `stated`; low = income.low - spend.high, high = income.high - spend.low)

- [ ] **Step 1: Write failing tests** with the spec's rules as assertions (also `months.test.ts`: `previousMonths("2026-03-15", 3)` crosses year end, February in a leap year, `monthsBetween` for the 12-month test):

```ts
test("three full months: middle = median net, range = min and max", ...)
test("current partial month is excluded (asOf mid-month)", ...)
test("'Eigen overboeking' and txs naming another own account are excluded both ways", ...)
test("debt repayment (DUO, loan) counts as spending", ...)
test("one-off large inflow is included and widens the range", ...)
test("two full months -> computed with partial=true, never extrapolated to three", ...)
test("zero full months -> { kind: 'none', reason: 'no-full-month' }; no txs -> 'no-data'", ...)
test("business-entity account txs are left out; no entity profiles -> all accounts count", ...)
test("mode 'convert': toEur on the tx date, rounded once per tx with Math.round(x*100)/100 in cents before summing; toEur null -> excluded and counted in excludedForeignCount", ...)
test("mode 'separate': every non-EUR tx excluded and counted", ...)
test("account A covers 3 months, account B only 1: only fully covered months are used; with just 1-2 qualifying months the result is partial=true, never padded", ...)
test("a month is covered only if every in-scope account WITH transactions covers it: first tx on/before day 3 of the month (or account linked later = out of scope that month) and last tx or balanceDate on/after the last day; an account with no txs is ignored", ...)
test("card account IN scope: settlement excluded, card purchases counted", ...)
test("card account OUT of scope (not linked or business): the settlement counts as spending", ...)
test("roomFromStated: income 2500-3000, spend 2000-2200 -> low 300, high 1000", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/core test -- advisor/room`. Expected: FAIL.
- [ ] **Step 3: Implement.** Candidate months = `previousMonths(asOf, 6)` excluding `asOf`'s month; keep a month only if fully covered per the coverage rule above (per-account span = first tx date to max(last tx date, balanceDate)); take the three most recent kept months. Convert foreign amounts to cents once per tx, then sum integers. Median of three = the middle sorted net; with 2 months use the mean (state as `middleCents`, note in code comment why); with 1 month middle = that month. Categorize with `categorize(tx, rules, own)`; skip `"Eigen overboeking"`; handle the card-settlement double-count as the last test says (see spec gap note in report).
- [ ] **Step 4: Run to verify pass**.
- [ ] **Step 5: Review Focus pin:** all months negative (returned, copy decides wording), `Number.isInteger` on every cents field, leap-year February.
- [ ] **Step 5b:** `roomFromStated(income, spend)` lives in `room.ts` with its test (low = income.low - spend.high, high = income.high - spend.low).
- [ ] **Step 6: Stage (owner commits):** `git add packages/core/src`

---

### Task 5: Capacity and tolerance scoring (spec 10.3)

**Files:**
- Create: `packages/core/src/advisor/thresholds.ts`, `capacity.ts`, `riskScale.ts`, `knowledge.ts` and a `.test.ts` for each
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `RoomResult.middleCents` / `middleIncomeCents` (Task 4), `proposeDebts` (Task 3), `proposeFixedCosts`, `proposeSavings`.
- Produces:
  - `export const CAPACITY_THRESHOLDS` (ONE table): `{ bufferMonths: [1, 3], roomShare: [0, 0.10], debtShare: [0.10, 0.30], horizonYears: [3, 10], sumToScore: [{max:1,score:1},{max:3,score:2},{max:5,score:3},{max:7,score:4},{max:8,score:5}] }`. Starting point, not research-backed (comment says so).
  - `capacityInputs(i: { savingsCents: number; fixedCostsMonthlyCents: number /*housing + recurring outgoing streams + subscriptions*/; room: RoomResult; debtPaymentsMonthlyCents: number; goals: { targetDate: string }[]; asOf: string }): { bufferMonths: number | null; roomShare: number | null; debtShare: number | null; horizonYears: number | null }` — roomShare = `room.middleCents / room.middleIncomeCents`; debtShare = `debtPaymentsMonthlyCents / room.middleIncomeCents` (debt payments = sum of `proposeDebts` monthly amounts plus user-stated debts); both null when room is not `computed` or `middleIncomeCents <= 0`; horizonYears = years (via `months.ts`) to the NEAREST goal date, null with no goals.
  - `scoreCapacity(i): { score: 1|2|3|4|5 | null; parts: { buffer: 0|1|2|null; room: 0|1|2|null; debt: 0|1|2|null; horizon: 0|1|2|null }; missing: string[] }`. Points: buffer <1 -> 0, 1 to 3 inclusive -> 1, >3 -> 2; room share <0 -> 0, 0 to 0.10 inclusive -> 1, >0.10 -> 2; debt share >0.30 -> 0, 0.10 to 0.30 inclusive -> 1, <0.10 -> 2; horizon <3 -> 0, 3 to 10 inclusive -> 1, >10 -> 2. Sum 0-1 -> 1, 2-3 -> 2, 4-5 -> 3, 6-7 -> 4, 8 -> 5. A null input scores nothing and is listed in `missing`; score is null when fewer than 3 inputs exist; with 3 inputs the sum is scaled by 8/6 and rounded before mapping (stated in a code comment).
  - `bufferMonths(savingsCents: number, fixedCostsMonthlyCents: number): number | null` (null when fixed costs are 0)
  - `RISK_SCALE: { id: "lavega-draft-1"; source: string; licence: string; items: { id: string; options: { id: string; points: 1|2|3|4|5 }[] }[] }` — 5 scenario items, 4 options each with points 1 (most loss-averse) to 5 (most tolerant), e.g. item `loss-20`: sell everything = 1, sell half = 2, do nothing = 4, buy more = 5. `source: "UNVERIFIED: draft, owner confirms scale and licence before launch"`; a test asserts `licence` is non-empty and the UNVERIFIED marker is present, so launch needs a conscious edit.
  - `scoreTolerance(answers: Record<string, string>): { score: 1|2|3|4|5 | null; answered: number }` — mean of the answered points, rounded half up (`Math.floor(mean + 0.5)`), clamped to 1..5; null if fewer than 4 answered. Mapping: mean 1.0-1.49 -> 1, 1.5-2.49 -> 2, 2.5-3.49 -> 3, 3.5-4.49 -> 4, 4.5-5 -> 5.
  - `toleranceBucket(score): "conservative" | "balanced" | "aggressive"` (1-2 conservative, 3 balanced, 4-5 aggressive)
  - `capacityToleranceFlag(capacity: number | null, tolerance: number | null): "disagree" | "agree" | "unknown"` (disagree when `Math.abs(c - t) >= 2`)
  - `KNOWLEDGE_QUESTIONS` (3: interest, inflation, diversification; one correct option each), `scoreKnowledge(answers): number`, `experienceOf(correct, investedBefore): "beginner"|"some"|"experienced"` (beginner: not invested and <=1 correct; experienced: invested and 3 correct; else some)
  - `riskDue(riskAt: string, asOf: string, events: LifeEvent[]): boolean` using `monthsBetween` from `months.ts`: due at >= 12 months, or sooner on a life event after `riskAt` (child, income change over 20%, new debt); `LifeEvent = { kind: "child" | "income-change" | "new-debt"; at: string }`

- [ ] **Step 1: Write failing tests** with the spec's boundary values:

```ts
test.each([[0.5,0],[1,1],[3,1],[3.01,2]])("buffer months %s -> %s points", ...)   // <1, 1-3, >3
test.each([[-1,0],[0,1],[0.10,1],[0.11,2]])("room share ...", ...)               // negative, 0-10%, >10%
test.each([[0.31,0],[0.30,1],[0.10,1],[0.09,2]])("debt share ...", ...)           // >30%, 10-30%, <10%
test.each([[2.9,0],[3,1],[10,1],[10.1,2]])("horizon ...", ...)                    // <3, 3-10, >10
test("all four max -> 5; all zero -> 1", ...)
test("income zero: roomShare and debtShare are null, listed in missing, no NaN/Infinity", ...)
test("capacity 5 vs tolerance 3 -> disagree; 4 vs 3 -> agree; null -> unknown", ...)
test.each([[1.49,1],[1.5,2],[2.49,2],[2.5,3],[3.49,3],[3.5,4],[4.49,4],[4.5,5]])("tolerance mean %s -> %s", ...)
test("tolerance buckets 1..5", ...)
test.each([[0,1],[1,1],[2,2],[3,2],[4,3],[5,3],[6,4],[7,4],[8,5]])("capacity sum %s -> score %s", ...)
test("capacityInputs: roomShare uses middleIncomeCents; room kind 'none' or income 0 -> null shares; debtShare uses proposeDebts monthly sum", ...)
test("three of four inputs present -> scaled sum, score non-null; two present -> null", ...)
test("fewer than 4 risk answers -> score null", ...)
test("experience mapping table", ...)
test("riskDue: 11 months no event false; 12 months true; 3 months + income change 21% true, 19% false", ...)
test("thresholds exist in exactly one exported table (grep guard): no numeric literal 0.30 or 0.10 appears in capacity.ts", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/core test -- advisor` Expected: FAIL.
- [ ] **Step 3: Implement** reading only from `CAPACITY_THRESHOLDS`. Boundary semantics exactly as the `test.each` rows state (inclusive lower band edge as written).
- [ ] **Step 4: Run to verify pass** + `pnpm typecheck`.
- [ ] **Step 5: Review Focus pin:** no goals (horizon null -> missing, not 0 points), zero fixed costs (buffer null), partial risk answers.
- [ ] **Step 6: Stage (owner commits):** `git add packages/core/src`

---

### Task 6: Intake UI: step 0 through block 3, with resume

**Files:**
- Create: `apps/web/src/copy/intake.ts`, `apps/web/src/intake/state.ts`, `apps/web/src/intake/state.test.ts`, `apps/web/src/intake/Step0.tsx`, `Block1.tsx`, `Block2.tsx`, `Block3.tsx`, `ProposalCard.tsx`, `RoomPayoff.tsx`, `apps/web/src/views/Intake.tsx`, `apps/web/src/views/Intake.test.tsx`
- Modify: `apps/web/src/appRoutes.ts` (add `View` `"intake"`, segment `intake`), `apps/web/src/App.tsx` (load profile into state at ~568-595; `saveProfile` like `saveRewards` at ~953; render branch), `apps/web/src/copy/parity.test.ts` (add `intakeCopy`), `apps/web/src/copy/shell.ts` (`topBar.viewTitles` entry for `intake`). Widget ids added later (Task 8) must not equal any `ModuleId` or any new route id (`intake`, `about-you`); the existing test `ModulePicker.test.tsx` "geen enkele widget-id is ook een module-id" (~line 262) must still pass and is extended with the new View ids
- Reuse: `Import` view (upload), `BankLink` (bank connect), `getFxConversionMode`, `setAppLocale`, `setHomeCountry`, `setHomeRegion`

**Interfaces:**
- Consumes: all of Tasks 2 to 5.
- Produces:
  - `intakeCopy: Record<Locale, IntakeCopy>` (typed-complete; question text uses function-valued entries for amounts)
  - `IntakeState = { profile: AdvisorProfile; stage: "step0" | "block1" | "block2" | "block3" | "done" }` and pure reducers: `applyProposalAnswer(profile, proposal, answer: { kind: "confirm" } | { kind: "correct"; value: ... } | { kind: "notMine" }, asOf): AdvisorProfile` (confirm -> `source: "confirmed"`, correct -> `"stated"`, notMine -> `removeDerived`), `applyStatedRange(profile, section, range): AdvisorProfile` (`source: "stated"`), `resumeStage(profile): IntakeState["stage"]` from `profile.intake.blocksDone`
  - `Intake` props: `{ accounts, txs, rules, own, profiles, asOf, mode, fxHistory, store: AdvisorProfileStore | null, onSave(next: AdvisorProfileStore): Promise<void>, onNavigate(view: View): void }`

- [ ] **Step 1: Write failing tests**

```ts
// state.test.ts
test("confirm -> confirmed with evidence kept; correct -> stated; notMine -> fingerprint in removed", ...)
test("resumeStage: blocksDone 0 -> step0, 1 -> block2, 3 -> done", ...)
// Intake.test.tsx (jsdom, same harness as Profiel.test.tsx)
test("step 0 offers connect, upload, continue-without; continue-without shows range questions in block 1", ...)
test("with linked data block 1 shows 'We think ...' cards, each with Confirm / Correct / Not mine and expandable evidence", ...)
test("each answer saves immediately (onSave called per answer); closing and reopening resumes at the first unfinished block", ...)
test("fewer than 60 days of data: card shows the thin-data sentence and the question instead of a proposal", ...)
test("child signal card asks 'Do you have children?' and records only the answer; no signal -> block 2 still asks", ...)
test("end of block 1 shows RoomPayoff: headline, low-high range, expandable calculation; 'none' result shows the not-enough-data text", ...)
test("block 3: risk items, knowledge items, optional worries free text; capacity/tolerance disagreement flag is shown, not resolved", ...)
test("NL and EN render with no key missing (copy parity) and no Dutch string literal in intake/*.tsx", ...)
```
The last test greps `apps/web/src/intake/*.tsx` and `views/Intake.tsx` for a small Dutch word list (en, de, het, niet, voor, rekening) inside string literals, failing on a match.

- [ ] **Step 2: Run:** `pnpm --filter @lavega/web test -- intake Intake parity` Expected: FAIL.
- [ ] **Step 3: Implement.** Layout and visual design are the builder's call (spec section 9); use `components/ui/Card|Button|Field`. Step 0 embedding: read `Import.tsx` and `BankLink.tsx` props first. Render each INLINE inside the step 0 card (no navigation away), passing the existing save callbacks from `App.tsx`; on their success callback (accounts/txs state changed) the intake advances to block 1 and re-runs inference from the new `accounts`/`txs` props. If `BankLink` redirects out to the bank and returns via `/app?eb=...`, persist `intake.step0 = "bank"` BEFORE the redirect (saved profile) and on return `resumeStage` lands at block 1 using that value. Test both returns (inline upload success; bank redirect return). Step 0 also carries the language, country and region fields moved from `Onboarding.tsx` (Task 9 deletes the old step). Block 2 collects household, children (count and birth year each, no names), goals as buckets using the `Goal` schema of Task 2 (purpose, kind general or child with the child, target amount, date, priority flexible/important/must; `plannedMonthlyCents`, `startingBalanceCents` and `accountRefs` optional), debts outside linked accounts, buffer months wanted. Block 3 per Task 5. Save after every answer through `onSave(commitProfile(store, next))`. If you add motion, load `emil-design-eng` first and keep it restrained.
- [ ] **Step 4: Run to verify pass** + `pnpm typecheck && pnpm lint && pnpm format`.
- [ ] **Step 5: Review Focus pin:** the tests above for thin data, no data, and resume; plus "profile saved before Block 2 survives a reload (`getAdvisorProfile` mocked from the previous `put`)".
- [ ] **Step 6: Run it for real:** use the `run` skill (or `verify-lavega` if installed in this worktree) to open `/app/intake` with a fixture vault and record screenshots of step 0, block 1 (data and no-data), and the payoff. Report the evidence path; do not claim UI works from unit tests alone.
- [ ] **Step 7: Stage (owner commits):** `git add apps/web`

---

### Task 7: "What LaVega knows about you"

**Files:**
- Create: `apps/web/src/views/AboutYou.tsx`, `apps/web/src/views/AboutYou.test.tsx`
- Modify: `apps/web/src/appRoutes.ts` (`View` `"about-you"`), `apps/web/src/views/Profiel.tsx` (link card), `apps/web/src/App.tsx` (render branch), `apps/web/src/copy/intake.ts` (add `aboutYou` tree), `apps/web/src/copy/shell.ts` (`viewTitles`)

**Interfaces:**
- Consumes: `AdvisorProfileStore`, `removeDerived`, `commitProfile`, `scoreCapacity` (capacity is displayed as computed, labelled "computed", never editable).
- Produces: `AboutYou` props `{ store: AdvisorProfileStore | null; capacity: ReturnType<typeof scoreCapacity>; onSave(next: AdvisorProfileStore): Promise<void>; onNavigate(view: View): void }`. Lists every profile field with value, source (derived/confirmed/stated), date, Edit and Remove. Remove on a derived field calls `removeDerived`. It sits under Profiel (a link card there) with its own route segment `about-you` because `viewFromPathname` reads one path segment (the spec's "under Profiel" is satisfied by navigation, not URL nesting).

- [ ] **Step 1: Write failing tests**

```ts
test("every populated field row shows value, source and date; a field with no data shows nothing invented", ...)
test("Remove on a derived field stores its fingerprint; the inference list for the same evidence no longer proposes it (run proposeIncomeStreams with isSuppressed)", ...)
test("Edit turns a derived field into stated with a new date", ...)
test("capacity row is read-only and says computed; no edit control", ...)
test("empty profile shows the invite to start the intake, not an empty table", ...)
test("renders in NL and EN", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/web test -- AboutYou` Expected: FAIL.
- [ ] **Step 3: Implement** a table driven by one `FIELD_ROWS` list (section key -> copy label key -> renderer), so a new profile section without a row is a type error.
- [ ] **Step 4: Run to verify pass**, then `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Review Focus pin:** Remove then re-import identical data keeps it suppressed; removing a `stated` field deletes it (not suppressed); free-text worries rendered as text (no HTML injection: assert `<script>` stays literal).
- [ ] **Step 6: Stage (owner commits):** `git add apps/web`

---

### Task 8: Overzicht invitation and room card

**Files:**
- Create: `apps/web/src/components/blocks/RoomCard.tsx`, `apps/web/src/components/blocks/RoomCard.test.tsx`, `apps/web/src/components/blocks/IntakeInviteCard.tsx` (+ test)
- Modify: `apps/web/src/views/Overzicht.tsx`, `apps/web/src/components/moduleRegistry.tsx` (widget entries `room-card` and `intake-invite`, `defaultOn: true`, with thumbnails; neither id may equal a ModuleId or the route ids `intake`, `about-you`; `ModulePicker.test.tsx` "geen enkele widget-id is ook een module-id" must pass), `apps/web/src/copy/shell.ts` (`modulePicker` widget labels, typed by `WidgetId`), `apps/web/src/copy/intake.ts`, `apps/web/src/App.tsx` (pass `store`, run `computeRoom` once per data change with `useMemo`)

**Interfaces:**
- Consumes: `computeRoom`, `RoomResult`, `AdvisorProfileStore`.
- Produces: `RoomCard` props `{ result: RoomResult; onOpenIntake(): void }`; `IntakeInviteCard` props `{ onStart(): void; resumeAt: "step0"|"block1"|"block2"|"block3"|null }`. Invitation shows when `store === null` or `blocksDone < 3`; room card shows once `blocksDone >= 1` (block 1 done), otherwise the invitation.

- [ ] **Step 1: Write failing tests**

```ts
test("no profile -> invitation card with Start; click navigates to the intake view", ...)
test("blocksDone 1 -> room card with headline, low-high range, expandable calculation", ...)
test("result none -> card says there is not enough data and links to import; result partial -> says it used fewer than three months; excludedForeignCount > 0 -> card says how many foreign-currency transactions were left out", ...)
test("negative room is shown as a negative amount with neutral wording (no advice sentence)", ...)
test("no sentence in the room card copy recommends an amount to invest (copy scan using `findAdviceLanguage` from `packages/core/src/advice/language.ts` plus the room-specific phrases 'invest', 'invester', 'per maand beleggen' in intake room strings; no local banned-word list)", ...)
test("widgets appear in the picker (WIDGETS) and respect enable/disable", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/web test -- RoomCard IntakeInvite module-grid overzicht` Expected: FAIL.
- [ ] **Step 3: Implement.** Existing users who saw onboarding get the invitation, not step 0's settings again (Task 9 relies on this). `IntakeInviteCard` is registered as a widget so users can dismiss it via the picker; dismiss state uses the widget preference store already in `moduleRegistry.tsx`.
- [ ] **Step 4: Run to verify pass** + `pnpm typecheck && pnpm lint && pnpm format`.
- [ ] **Step 5: Review Focus pin:** a vault with 20 days of data (none result), a vault where all accounts belong to a business entity (room card shows "none/no personal accounts", not a business number).
- [ ] **Step 6: Run it for real** with the `run` skill: screenshot Overzicht for (a) no profile, (b) after block 1. Report evidence path.
- [ ] **Step 7: Stage (owner commits):** `git add apps/web`

---

### Task 9: Replace onboarding

**Files:**
- Modify: `apps/web/src/App.tsx` (~447, ~1521-1530: `showOnboarding` branch renders `Intake` step 0 instead of `Onboarding`), `apps/web/src/onboarding.ts` (keep `onboardingSeen`/`markOnboardingSeen`/`showOnboarding` unchanged: they gate existing users), `apps/web/src/copy/shell.ts` (remove `onboarding` tree from both languages), `apps/web/src/landingCopy.ts` and `apps/server/src/agent/prompts/` (now add the intake pointers deferred from Task 1), `apps/web/src/copy/parity.test.ts`
- Delete: `apps/web/src/components/Onboarding.tsx`, `apps/web/src/onboarding.test.tsx` (migrate its still-relevant cases: fresh-vault-only, seen flag, restore-backup path)
- Test: `apps/web/src/onboarding.test.ts` (new, logic only), `apps/web/src/Root.test.tsx`/`App.test.tsx` as they reference onboarding

**Interfaces:**
- Consumes: `Intake` (Task 6), `IntakeInviteCard` (Task 8).
- Produces: a fresh vault opens `Intake` at step 0 with language/country/region fields; scope choice is gone; `setDefaultScope` is never called by new code. Existing users (onboarding seen, or a non-fresh vault) never see step 0's settings again; they get the Overzicht invitation.

- [ ] **Step 1: Write failing tests**

```ts
test("fresh vault and not seen -> intake step 0 is shown; seen or non-fresh -> app with invitation card", ...)
test("step 0 writes language, country and region exactly as Onboarding did (same settings keys), writes nothing for blank fields", ...)
test("no scope question exists anywhere in step 0 and setDefaultScope is not called", ...)
test("restoring a backup onto a new browser (gate 'setup') does not overwrite an existing country with a guess (storedHomeCountry, not getHomeCountry)", ...)
test("intake copy mentions only features that still exist (scan landing + shell copy for facturen|belasting|btw|valuta|zakelijk after Task 1)", ...)
```

- [ ] **Step 2: Run:** `pnpm --filter @lavega/web test` Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.** Reuse the field-initialisation logic and its reasons from `Onboarding.tsx` (start from stored values, only write what was entered). Mark onboarding seen when step 0 completes or is skipped.
- [ ] **Step 4: Run the whole gate:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format`. Expected: all green; list any test deleted or rewritten and why.
- [ ] **Step 5: Run it for real** (`run` or `verify-lavega`): fresh account first sign-in lands on step 0, completes block 1 with a bank export, sees the room card on Overzicht. Report evidence path. Also confirm `/app/facturen`, `/app/belasting`, `/app/valuta` land on Overzicht.
- [ ] **Step 6: Review.** Hand the whole branch to an independent reviewer (built-in `/code-review`, or a sonnet reviewer with the interrogate rubric). This branch touches personal financial data and a server write, so use pstack `interrogate` for Tasks 2, 5 and 8. Fix everything under "Act on"; list "Consider" for the owner.
- [ ] **Step 7: Stage (owner commits):** `git add -A apps packages docs` then print the "read this before committing" block (what changed, evidence paths, reviewer findings and resolutions, what is left).

---

## Self-Review (done against the spec)

- Spec 3 (archive): Task 1. Landing/onboarding/chat/prompts copy: Tasks 1 and 9. Server routes stay: no task touches them, by design.
- Spec 4.1 to 4.3: Tasks 6 and 9 (placement, resume, step 0, block 1, payoff). Inference rules (3 occurrences, 60 days, no inferred children): Task 3.
- Spec 4.4, 4.5: Task 6 UI and Task 5 scoring; re-ask after 12 months or life event: `riskDue` (Task 5), surfaced on the invitation card in Task 8 (add a "risk is due" resume state there if time allows; flagged below).
- Spec 4.6: Task 7. Spec 4.7 shape: Task 2. AI projection: not built (10.5).
- Spec 5: `experience` stored (Tasks 5, 6); Overzicht room (Task 8).
- Spec 6 legal line: Global Constraints, banned-phrase scan in Task 8.
- Spec 10.1 to 10.8 (10.4 is a removed call): Tasks 4, 4, 5, (none), (none), 2, 1, 9.
- Names checked across tasks: `Proposal`, `fingerprint`, `isSuppressed`, `removeDerived`, `commitProfile`, `AdvisorProfileStore`, `personalView`, `computeRoom`/`RoomResult`, `scoreCapacity`, `toleranceBucket`, `riskDue` are defined before use.

## Spec gaps found while planning (decisions the plan makes; owner to confirm)

1. Risk scale and licence are not chosen (spec 9 defers to builder): plan ships a draft marked UNVERIFIED with a test that blocks silent launch.
2. "Cards and points" is a block-1 card (4.3) but has no profile section in 4.7: plan reads existing card/Punten data for display only and stores nothing new for it.
3. Credit-card settlement double count: 10.2 says settlements count as spending, but if the card account is also linked its purchases would double count. Plan: count card purchases and drop the settlement when the card account is in scope; otherwise count the settlement.
4. Capacity sum-to-score bands (0-8 to 1-5), tolerance score mapping, tolerance to 3 buckets, and knowledge to `experience` thresholds are unspecified: plan picks values in `thresholds.ts` / `riskScale.ts` / `knowledge.ts`.
5. No known-lender list exists for "visible debts": plan adds a small `lenders.ts` (DUO already recognised); coverage will be partial.
6. "Room from stated ranges" formula unspecified: plan uses low = income.low - spend.high, high = income.high - spend.low.
7. Spec says the page lives "under Profiel"; routing reads one path segment, so it is a separate route linked from Profiel.
8. "Risk is due" resurfacing (12 months / life event) has no UI owner in the spec; plan computes it in core and shows it on the invitation card.
