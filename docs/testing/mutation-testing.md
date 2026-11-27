# Mutation testing (pilot)

Coverage shows that a test ran a line. Mutation testing shows that a test would
fail if the line did the wrong thing. Stryker changes the source (for example
`>` to `>=`, or removes a branch call), runs the covering tests, and records the
result.

## Results

| Result      | Meaning                                             |
| ----------- | --------------------------------------------------- |
| Killed      | A test failed. The suite detects this change. Good. |
| Survived    | All tests passed. The suite misses this behaviour.  |
| No coverage | No test reached the changed line.                   |
| Timeout     | The changed code hangs, and the run stops it.       |

The mutation score is `(killed + timeout) / tested mutants`.

## Scope

The pilot covers money and tax logic in `@lavega/core` only. A wrong comparison
or a dropped branch in these files is a real financial error.

Files in the pilot:

- `src/money.ts`
- `src/tax.ts`
- `src/investing/costBasis.ts`
- `src/redact.ts`
- `src/sentryScrub.ts`
- `src/fx.ts`
- `src/investing/splits.ts`

`src/taxpacks/*.ts` hold constant rate tables. `ignoreStatic` skips every mutant
in them, so they are not in the list. Assert those values directly in their own
tests instead.

## Baseline (2026-11-27)

| File           | Mutants tested | Score | Survived | No coverage |
| -------------- | -------------- | ----- | -------- | ----------- |
| `money.ts`     | 15             | 93.3% | 1        | 0           |
| `tax.ts`       | 354            | 81.1% | 62       | 5           |
| `costBasis.ts` | 497            | 67.4% | 141      | 21          |
| All files      | 866            | 73.4% | 204      | 26          |

The full list runs in about 2.5 minutes with `concurrency: 4`. `costBasis.ts` is
the weak spot: cost basis, fees and FX handling need tighter assertions.

React views, copy, styling and API glue are out of scope. Mutation results for
that code are slow and noisy, and the tests there assert behaviour less well.

Widen the list one file at a time. Check the run time after each addition.

## Run

```bash
# Full pilot (writes packages/core/reports/mutation/).
bun run mutation:pilot

# One file, while you work on it.
cd packages/core
bunx stryker run --mutate src/tax.ts

# Check the configuration without running mutants.
bun run --cwd packages/core mutation:dry
```

The HTML report opens at `packages/core/reports/mutation/index.html`.

Stryker runs in incremental mode. The cache lives in
`packages/core/.mutation/incremental.json`, so a second run tests only the
mutants whose covering tests changed. Delete that file to force a full run.

## Read a survivor

A survivor means a test is missing an assertion. It does not mean the code is
wrong.

For each survivor:

1. Open the report and read the diff that Stryker shows.
2. Ask which behaviour that diff would break.
3. Add or tighten the assertion that names that behaviour.
4. Run the file again and confirm that the mutant is now killed.

Do not change the source to make a survivor disappear unless the source is
actually wrong.

## Thresholds and gating

The configuration sets `high: 80` and `low: 60` for the colour scale in the
report. It sets no `break` threshold, so the run never fails.

The pilot workflow (`.github/workflows/mutation-pilot.yml`) runs weekly and on
demand on `master`. It does not run on pull requests and it does not gate a
merge. It uploads the reports as the `mutation-report` artifact and writes the
score to the job summary.

Promote the pilot to a gate only when all of these are true:

- The run finishes well inside its job timeout.
- The score is stable between runs.
- Survivors in the in-scope files are explained, not just counted.

Then add `break` to the thresholds and keep the gate on the small file list.

## Limits

Stryker copies the package into a sandbox and runs the tests there. Tests that
read fixtures from the repository root cannot run in that sandbox. The file
`packages/core/vitest.mutation.config.ts` excludes them. They do not cover the
files in scope. When you add a file to the pilot list, check that its tests do
not need a root fixture.

`ignoreStatic: true` skips mutants that change module-level code, because each
of them needs a full test run. This keeps the pilot fast. A static mutant that
survives is still a real gap, but this pilot does not report it.
