# Account delete + duplicate detection/merge — implementation plan

> Implemented via subagent-driven-development. Spec: docs/superpowers/specs/2026-08-13-account-delete-dedup-design.md

**Goal:** delete accounts (+their txs) and detect/merge duplicate accounts. Deterministic, local-first, confirm-first. No LLM/network.

## Global Constraints

- Pure `@lavega/core` logic (no `Date.now`/`Math.random`; ids via `hash.ts`).
- Storage removal primitives added to BOTH adapters with parity tests; encrypted writes go through `enqueueWrite`.
- Confirm-first on every destructive action (delete, merge).
- Merge must regenerate tx ids (id hash includes `accountKey`) and collapse overlap by `txBase` max-count — never double-count.

---

### Task 1: core — hash refactor + duplicate detection

**Files:** Modify `packages/core/src/hash.ts` (export `txBase`, `txId`; `assignTxIds` uses them). Create `packages/core/src/accounts.ts` (`canonicalAccountId`, `DuplicateGroup`, `findDuplicateAccounts`). Export from `index.ts`. Test `packages/core/src/accounts.test.ts` (+ assert `assignTxIds` output unchanged in `hash.test.ts` or accounts.test).

- `txBase(r)` = `[r.accountKey, r.date, r.amount.toFixed(2), norm(cp).slice(0,40), norm(desc).slice(0,60)].join("|")`; `txId(base, n)` = `hash(base + "#" + n)`; `assignTxIds` rebuilt on them (identical output).
- `canonicalAccountId`, `findDuplicateAccounts`, survivor pick — per spec.

### Task 2: core — mergeAccounts

**Files:** Modify `packages/core/src/accounts.ts` (+ `mergeAccounts`). Test in `accounts.test.ts`.

- Re-key duplicate txs to survivor; union by `txBase` max-count; surplus ids via `txId(base, survivorCount+i+1)`; enrich empty survivor iban; drop duplicate; no-op guard.

### Task 3: adapters — deleteAccount + deleteTxs

**Files:** Modify `StorageAdapter.ts`, `indexeddb.ts`, `encryptedStorage.ts`. Tests in `indexeddb.test.ts` + `encryptedStorage.test.ts` (parity).

- Interface + both impls per spec; encrypted through `enqueueWrite`.

### Task 4: web — delete account

**Files:** Modify `apps/web/src/App.tsx` (`handleDeleteAccount`, pass to Rekeningen) + `apps/web/src/views/Rekeningen.tsx` (Verwijder button + inline confirm + `onDeleteAccount` prop). Logic test if a helper is factored.

- Compute tx ids for key → `deleteTxs` + `deleteAccount`; filter state.

### Task 5: web — duplicate banner + merge

**Files:** Modify `apps/web/src/App.tsx` (`duplicateGroups` memo, `handleMergeDuplicates`, pass props) + `apps/web/src/views/Rekeningen.tsx` (banner + Samenvoegen + inline confirm).

- Persist merge diff (deleteTxs old dup ids, putTxs surplus, putAccounts survivor, deleteAccount dup); banner shows groups intersecting the scoped view.

---

Then: whole-branch review (Opus), fixes, finishing-a-development-branch → merge master.
