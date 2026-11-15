# Personal assistant (client-side thin slice)

An **Assistent** card at the top of Overzicht answers questions about the owner's
own figures from the unlocked vault, and asks for an explicit approval before it
remembers a preference. Everything runs in the browser: no assistant request
reaches the server, and an approval decision survives a reload because it is
stored in the vault.

## Sub-features

- Ask "wat heb ik deze maand uitgegeven?" / "what did I spend this month?" — a
  month total plus the largest categories, computed from the vault's own rows.
  Pending and excluded rows are counted separately, never in the total.
- Ask "wat is mijn saldo?" / "how much money do I have?" — accounts with their
  balance; an unknown balance stays unknown.
- Ask "onthoud dat ik korte antwoorden wil" / "from now on answer in English" —
  an approval card. Nothing is stored until the owner taps Onthoud/Remember or
  Nee/No. The decision event (tool, payload, decision, time) and, on approval,
  the preference are one vault save.
- After a reload the decided row and the remembered preference are still shown;
  an approved `lengte: kort` preference drops the category breakdown from the
  next spending answer.
- An unmapped question says what this version can answer instead of guessing.

## How to get to it (user POV)

Sign in and open `/app` (Overzicht). The **Assistent** card is the first card,
above the module grid. Type in the field labelled by its placeholder and press
**Vraag** / **Ask**.

## Driving it with control-lavega + browser

```bash
C=".claude/skills/verify-lavega/control-lavega.mjs"
E=/tmp/lavega-verify/evidence
node $C up                       # port 8797, guard open, no database
node $C doctor
node $C guard --out $E/guard-local.json
pnpm --filter @lavega/web build  # if dist is older than the change
```

In the browser tab on `http://127.0.0.1:8797/app`:

1. Locate `[data-testid="assistant-panel"]`; capture the panel.
2. Type a spending question into `#assistant-input`, submit, capture the answer in
   `[data-testid="assistant-log"]`.
3. Type a remember request; capture `[data-testid="assistant-approval"]` (the
   open card) and confirm `[data-testid="assistant-decisions"]` is absent.
4. Click **Onthoud**; capture the decided row and
   `[data-testid="assistant-memories"]`.
5. Reload the page; capture the same decided row and memory. That is the
   persistence proof.
6. Check the network log while steps 2-5 run: no request from the assistant path
   (the only traffic is the app's own vault/session reads). The panel test also
   stubs `fetch` to throw and still passes.

Evidence: `assistant-before.png`, `assistant-answer.png`,
`assistant-approval.png`, `assistant-decided.png`, `assistant-after-reload.png`,
and a page-text capture per step, under `/tmp/lavega-verify/evidence/`.

## Gotchas

- The local run has no database, so the vault owner is `device` and the key lives
  in this browser's IndexedDB. A second port is a second, empty vault; the same
  port keeps the decision across reloads, which is what the proof needs.
- An empty vault gives "no spending found" rather than a zero: import a bank file
  first if the answer should show a figure.
- The assistant has no model call in this slice. Do not expect free-form answers;
  the three intents above are the whole surface.
- The panel is additive: with no vault (signed out) it is not rendered at all.
