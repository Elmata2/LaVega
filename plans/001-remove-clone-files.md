# Plan 001: Remove the untracked conflict-copy files and restore the verification baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2cd8f1ea1..HEAD -- .gitignore apps/email-worker apps/extension apps/investing-server apps/investing-web packages docs db scripts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — deleting untracked files is irreversible; 14 of them differ from their sibling
- **Depends on**: none (this plan unblocks every other plan's gates)
- **Category**: dx
- **Planned at**: commit `2cd8f1ea1`, 2026-11-10

## Why this matters

The working tree contains roughly 1,060 untracked files whose names are a copy
of a tracked file with ` 2` appended: before the extension (`agentRun 2.ts`,
`app.test 2.ts`) or at the end of an extension-less name (`.dockerignore 2`,
`NOTICE 2`). They came from a Finder/iCloud style conflict copy, not from git.
They are not tracked, are not in `.gitignore`, and the TypeScript and lint
configs pick up the `.ts` ones.

The cost is concrete and already paid on `2cd8f1ea1`:

- `pnpm typecheck` **fails**: `apps/email-worker/src/cloudflare-email.d 2.ts(15,16): error TS2300: Duplicate identifier 'EmailMessage'.`
- `pnpm lint` **fails**: 11 errors, all inside `* 2.*` files (e.g. `apps/extension/src/chrome.d 2.ts:97` — `onAdded` declared but never used).
- A warm local `pnpm typecheck` took 4m19s on this tree; CI on a clean checkout takes 51s. The clones are compiled twice.
- CI never sees the clones (it checks out a clean tree), so "green in CI, red locally" is built in, and a stale clone can diverge from its sibling without anyone noticing.

After this plan: typecheck and lint are green locally on the investing side,
and a copy cannot silently re-enter the tree.

## Current state

- Files: every directory under `apps/`, `packages/`, `docs/`, `db/`, `scripts/`,
  `.claude/`, `.github/`, `.githooks/`, `.cursor/` and the repo root.
- `.gitignore` (lines 1-40) has no rule for conflict copies. Line 18 is
  `.DS_Store`; the block after it is the orphan section.
- `.dockerignore:20` already excludes them from the Docker build context:
  ```
  **/* 2.*
  **/* 3.*
  ```
- `.dockerignore:1-25` does **not** exclude `repos/` (separate finding, out of scope here).
- `git ls-files | grep -c ' 2\.'` → `0`: none of them is tracked. Verified.
- Audit evidence at the planned commit:
  - 1,062 candidate files outside `repos/`, `node_modules/` and build
    output: 1,053 named `* 2.*` plus 9 named `* 2` (`NOTICE 2`,
    `.dockerignore 2`, …).
  - 1,049 are byte-identical to the sibling with the ` 2` marker removed.
  - 13 differ from the sibling; in all 13 the sibling is **newer** (the ` 2`
    copy is a stale older snapshot) and the copy adds no work the sibling
    lacks. Examples:
    `apps/investing-server/src/portfolioRead 2.ts`,
    `packages/core/src/investing/portfolio 2.ts`,
    `packages/core/src/investing/risk 2.ts`,
    `apps/investing-web/src/components/PortfolioSummaryCard 2.tsx`,
    `docs/investing/RISK 2.md`.
  - In the audited scope no candidate lacked a sibling. Eight files under
    `.gstack/` (gitignored runtime logs and token files) have no sibling; they
    are excluded by the inventory's skip list and must be left alone.

Repo conventions that apply: deletions are plain `rm` of untracked files; commit
messages are conventional commits (`fix(investing): …`, `test(investing): …`,
`refactor(investing): …`) as seen in `git log --oneline -20`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Full typecheck | `pnpm typecheck` | exit 0, "Tasks: N successful" |
| Lint | `pnpm lint` | exit 0, "Found 0 warnings and 0 errors" |
| Investing server tests | `pnpm --filter @lavega/investing-server test` | exit 0 |
| Investing web tests | `pnpm --filter @lavega/investing-web test` | exit 0 |
| Core tests | `pnpm --filter @lavega/core test` | exit 0 |
| Clone files left | `git status --porcelain -uall \| grep -cE ' 2(\.|$)'` | `0` |

Cold typecheck on a clean tree is ~1 minute; expect up to 5 minutes on the
first run after deletion.

## Scope

**In scope** (the only files you may modify):
- delete: the untracked `* 2.*` and `* 2` files listed by step 1's inventory
- `.gitignore` (add the guard patterns in step 7)

**Out of scope** (do NOT touch):
- `repos/**` — vendored read-only reference; excluded from the inventory anyway.
- `.gstack/**` — gitignored runtime logs; deleting them is not part of this plan.
- `node_modules/`, `dist/`, `.turbo/`, `.vercel/`, `.lavega/` — build/runtime state.
- Any tracked source file. If a clone file contains content the tracked sibling
  lacks, that is a finding to report, not an edit to make here.
- `.env*` files. **Never** run `git clean -xdf` or `git clean -fd`: it would
  delete `.env.local`, `.env.vercel`, `.lavega/`, `.vercel/` and `node_modules/`.

## Git workflow

- Branch: `advisor/001-remove-clone-files`
- One commit: `chore: remove untracked iCloud conflict copies and ignore them`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the inventory (read-only)

Run this from the repo root. It writes three lists under `/tmp/lavega-dups/`
and prints counts. Change nothing yet.

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p /tmp/lavega-dups
python3 - <<'PY'
import hashlib, os

ROOT = os.getcwd()
# Compare path SEGMENTS, never substrings: "/.git" is a substring of "/.github",
# and skipping .github would miss `.github/workflows/ci 2.yml`.
SKIP = {"node_modules", ".git", "repos", "dist", ".turbo", ".vercel", ".lavega", ".gstack"}
out = {"identical": [], "diverged": [], "orphan": []}

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

for base, dirs, files in os.walk(ROOT):
    if any(part in SKIP for part in os.path.relpath(base, ROOT).split(os.sep)):
        dirs[:] = []
        continue
    for name in files:
        if " 2." in name:
            sibling_name = name.replace(" 2.", ".", 1)
        elif name.endswith(" 2"):
            sibling_name = name[:-2]
        else:
            continue
        dup = os.path.join(base, name)
        sibling = os.path.join(base, sibling_name)
        rel = os.path.relpath(dup, ROOT)
        if not os.path.exists(sibling):
            out["orphan"].append(rel)
        elif md5(dup) == md5(sibling):
            out["identical"].append(rel)
        else:
            out["diverged"].append(rel)

for key, rows in out.items():
    with open(f"/tmp/lavega-dups/{key}.txt", "w") as fh:
        fh.write("\n".join(sorted(rows)) + ("\n" if rows else ""))
    print(f"{key}: {len(rows)}")
PY
```

**Verify**: six lines print; `identical` + `diverged` + `orphan` = 1,062 ± a
handful (the tree is live). If `identical` is 0 or `diverged` is 0, STOP — the
inventory logic is wrong.

### Step 2: Prove none of them is tracked

```bash
git ls-files | grep -cE ' 2(\.|$)' || true
git status --porcelain -uall | grep -E ' 2(\.|$)' | grep -v '^??' | head
```

**Verify**: the first command prints `0`; the second prints nothing. If a
`* 2.*` or `* 2` file is tracked, STOP — deleting it would rewrite history-relevant tree
state and needs a decision from the operator.

### Step 3: Review the 13 diverged copies (do not skip)

For each path in `/tmp/lavega-dups/diverged.txt`:

```bash
while IFS= read -r dup; do
  sibling="${dup/ 2./.}"
  echo "===== $dup"
  diff -u "$sibling" "$dup" | head -60
done < /tmp/lavega-dups/diverged.txt
```

Expected: the ` 2.` copy is an older snapshot; every hunk shows the sibling
adding code that exists in the current tree (e.g. `holdingsReturn`,
`RiskBasis`, newer doc paragraphs). At the audit commit, all 13 siblings had a
newer mtime than their ` 2.` copy, and the copy's unique lines were only the
older wording/shape of code the sibling already covers.

**Verify**: you have looked at all 13 diffs and can say, for each, that the
sibling is authoritative. Record the 13 paths and a one-line verdict each in
your final report.

### Step 4: Delete the identical copies

```bash
while IFS= read -r dup; do rm -f -- "$dup"; done < /tmp/lavega-dups/identical.txt
wc -l < /tmp/lavega-dups/identical.txt
git status --porcelain -uall | grep -cE ' 2(\.|$)'
```

**Verify**: the remaining clone count equals
`diverged + orphan + (any new copies)`, i.e. 13, not ~1,060.

### Step 5: Delete the reviewed diverged copies

Only after step 3's verdict:

```bash
while IFS= read -r dup; do rm -f -- "$dup"; done < /tmp/lavega-dups/diverged.txt
git status --porcelain -uall | grep -E ' 2(\.|$)' | head
```

**Verify**: only `.gstack/` orphans may remain (they are not shown by
`git status` because `.gstack/` is gitignored — confirming that is fine).

### Step 6: Re-run the gates

```bash
pnpm typecheck
pnpm lint
```

**Verify**: both exit 0. `pnpm typecheck` previously failed with
`apps/email-worker/src/cloudflare-email.d 2.ts(15,16): error TS2300`; that error
and all clone paths (`* 2.*` and `* 2`) must be gone from the output.

If the output still shows errors, read them:
- errors that name a ` 2.` path → a copy was missed; re-run step 1 and delete it.
- errors that name no ` 2.` path → STOP and report; they are pre-existing and
  out of scope for this plan.

### Step 7: Guard against re-entry

Add to `.gitignore`, immediately after the `.DS_Store` line (line 18):

```
# Finder / iCloud conflict copies ("agentRun 2.ts", "NOTICE 2"). Never tracked.
* 2.*
* 2
* 3.*
* 3
```

Tradeoff: these patterns also hide a legitimate file whose name ends in ` 2`.
That is acceptable here because the repo has none; name future files without a
trailing ` 2` rather than weakening the guard.

**Verify**:

```bash
touch "apps/investing-web/src/guard 2.test.tsx" "NOTICE 2"
git status --porcelain -uall | grep -cE 'guard 2|NOTICE 2' || true
rm -f "apps/investing-web/src/guard 2.test.tsx" "NOTICE 2"
```

Expected: `0` (the file is ignored). Delete the probe file afterwards — the
last line does that.

### Step 8: Full investing gates

```bash
pnpm --filter @lavega/core test
pnpm --filter @lavega/investing-server test
pnpm --filter @lavega/investing-web test
```

**Verify**: all three exit 0. If a suite was already red before this plan
(check with the operator or the run log), record that test name and confirm it
is unrelated to the deleted files.

## Test plan

No new tests. This plan removes non-source files; the verification is that the
existing suites still pass and that typecheck/lint flip from red to green.

## Done criteria

ALL must hold:

- [ ] `git status --porcelain -uall | grep -cE ' 2(\.|$)'` prints `0` (outside `.gstack/`, which git ignores)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0 with 0 errors
- [ ] `pnpm --filter @lavega/investing-server test` exits 0
- [ ] `pnpm --filter @lavega/investing-web test` exits 0
- [ ] `.gitignore` contains the two guard lines
- [ ] No tracked file was modified (`git status --porcelain` shows only `.gitignore`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- A `* 2.*` or `* 2` file is tracked by git (step 2).
- Step 3's diff shows content in a ` 2.` copy that the sibling lacks and that
  you cannot attribute to a later commit — do not delete that file; list it.
- `pnpm typecheck` or `pnpm lint` still fails on paths that do not contain ` 2.`.
- An in-scope file listed in "Current state" has drifted (for example, the
  clone count is 0 already, or `.dockerignore` no longer excludes them).
- Deleting would require touching `repos/`, `.env*`, `.gstack/`, or `node_modules/`.

## Maintenance notes

- `.dockerignore` already ignores `**/* 2.*`/`**/* 3.*`; keep it that way, and consider
  excluding `repos/` in a separate change (it is 53 MB of vendored reference
  that the image never reads at runtime).
- If a build or test starts picking up a file whose name contains ` 2`, the
  guard pattern failed to apply — check `.gitignore` first.
- The untracked `.gstack/` files with no sibling (`terminal-port`,
  `terminal-internal-token`, `browse-*.log`) are runtime state, not copies.
  They are gitignored and must not be committed.
