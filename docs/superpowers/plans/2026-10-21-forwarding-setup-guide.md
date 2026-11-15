# Forwarding Setup Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Never commit.** Every "Stage" step is `git add …` only; the owner commits himself.

**Goal:** A tester with Gmail or Outlook.com goes from "no address" to "a test mail arrived" inside Facturen, with Gmail's confirmation code shown in LaVega instead of in n8n's execution log.

**Architecture:** Core grows a pure classifier in `normalizeInboundMail.js` that tags Gmail confirmation mails and `LaVega test <code>` mails with `setup: {kind, code}` and forces `ok:false`, so the existing "Iets te lezen?" If-node routes them away from Claude to the "Melding: zelf ophalen" node, whose adapter now emits a code-only notice. The web app parses those two notice kinds into a separate `setup` list, Facturen applies them to a localStorage-backed guide state, and a new `ForwardingGuide` card renders the steps. Copy on Facturen/Koppelingen is rewritten to be true and free of internals.

**Tech Stack:** Plain JS with JSDoc for n8n code nodes (`packages/core/src/n8n/*.js`, vitest, `pnpm run sync:n8n`), TypeScript + React 18 + `effect@4.0.1` (Schema, DateTime) in `apps/web`, vitest + jsdom, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-21-forwarding-setup-guide-design.md` (approved by the owner). Read it fully before Task 1.

## Global Constraints

Copied from the spec / repo rules. Every task implicitly includes these.

- Deep links, verbatim: Gmail `https://mail.google.com/mail/u/0/#settings/fwdandpop` and `#settings/filters`; Outlook.com `https://outlook.live.com/mail/0/options/mail/rules`; work account `https://outlook.office.com/mail/options/mail/rules`. The two Outlook links and the M365 claim are **VERIFY** items (Task 9).
- Gmail filter search, verbatim: `has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)`. It lives in a code constant, **never in the copy tree** (the EN-has-no-Dutch gate in `apps/web/src/copy/parity.test.ts` bans the substring `rekening`).
- Notice kinds: `forwarding-confirmation` (digits only, max 20) and `setup-test` (`[a-z0-9]{4}`). Anything else in `code` drops the signal.
- Guide shows **only the code, never a link** from the confirmation mail. No model call for either kind. Attachments are not passed on.
- Test subject: `LaVega test <4 random chars>`; polling every 20 seconds for at most 10 minutes; collapsed guide line after the first pass.
- Remembered per device in localStorage, always inside try/catch; the page must render without it.
- Deploy order (spec section 5): **web first, then the n8n workflow.** Today's web build discards unknown notice kinds, and a fetch empties the queue.
- Copy: every new or changed string exists in NL and EN together, in `apps/web/src/copy/admin.ts`. No user-visible string under `facturen` or `koppelingen` contains `n8n`, `webhook`, `messageId` or `workflow` (case-insensitive). The allowlist is **empty**.
- Out of scope: OAuth, importing older invoices, providers beyond Gmail and Outlook, auto-booking, any change to `autoBookDecision` logic (copy only).
- Repo rules: `AGENTS.md` (STE-style short reporting; keep docs in step with code; Emil skills are for motion, and this plan adds none beyond what Facturen already has). Do not run `verify-investing`, do not open a browser.
- **Effect (ADR 0008) judgement.** ADR 0008 governs new _TypeScript_ logic. The n8n code nodes are plain `.js` pasted verbatim into n8n's bare `vm` by `stripModuleSyntax` (`packages/core/src/n8n/codeNodes.js:48-69` deletes every `import`), so an `import { Effect } from "effect"` there would be stripped and the node would crash at runtime. Therefore: **n8n `.js` files follow their existing idiom** (function declarations, JSDoc types, `indexOf`, no imports of anything not in the same pasted scope). **New web TypeScript** (`forwardingGuide.ts`, wire parsing in `n8n.ts`) uses `Schema` for untrusted input (localStorage, network) and `DateTime` for the clock; the pure state transitions stay plain functions because there is no I/O service to model. `n8n.ts` (637 lines, non-Effect) is **not** ported wholesale; only the new function is written Effect-style. This is a "Consider" item for the owner, not a bug.

## Review Focus

Inputs the spec implies but does not name. Each has a pinning test in the task shown.

1. **A forwarded mail with an empty Message-ID.** `addToQueue` silently skips notices without a `messageId` (`packages/core/src/n8n/queue.js:242`), so a setup mail would vanish and the guide would wait forever. Expected: a stable fallback id. Pinned in Task 3.
2. **The result arrives late or after navigating away.** The guide's state is local and the fetch only runs while Facturen is mounted. Expected: a signal that lands after the 10-minute window, or after a reload, still counts as received, and the older-code case says so. Pinned in Task 6 and Task 10.
3. **The server already holds an address but this browser has none** (second browser, cleared storage). Expected: "Maak mijn factuuradres" must not silently replace a live address with a new one. Pinned in Task 8.
4. **localStorage blocked, full, or holding garbage.** Expected: defaults, no throw, no blank card. Pinned in Task 6.
5. **Gmail resends the code, or two different codes arrive.** Expected: latest wins, nothing crashes, queue dedup holds. Pinned in Task 2, Task 3 and Task 6.

## File Structure

Create:

- `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.SYNTHETIC.json`: provisional, clearly marked.
- `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.json`: **owner-supplied real capture** (Task 1, manual). Not created by an agent.
- `packages/core/src/n8n/__fixtures__/gmailConfirmation.ts`: loads the real fixture if present, else the synthetic one; exports `FIXTURE_IS_REAL`.
- `packages/core/src/n8n/setupMail.test.ts`: classifier and normalisation tests.
- `apps/web/src/forwardingGuide.ts`: constants, Schema-backed guide state, pure transitions.
- `apps/web/src/forwardingGuide.test.ts`
- `apps/web/src/views/ForwardingGuide.tsx`: the card.
- `apps/web/src/forwardingGuide-ui.test.tsx`: render states in NL and EN.

Modify:

- `packages/core/src/n8n/normalizeInboundMail.js`: `classifySetupMail`, `setup` field, `ok:false` for setup mails.
- `packages/core/src/n8n/claudeToLaVega.js`: `noticeForSetup`, `QueueNotice` typedef.
- `packages/core/src/n8n/codeNodes.js`: `UNREADABLE_ADAPTER` dispatch.
- `packages/core/src/n8n/codeNodes.test.ts`, `claudeToLaVega.test.ts`, `pipeline.test.ts`.
- `docs/n8n/lavega-invoices.json`, `docs/n8n/lavega-facturen-workflow.json`: regenerated by `pnpm run sync:n8n` only; never hand-edited.
- `apps/email-worker/test/rawMail.ts`, `apps/email-worker/test/contract.test.ts`.
- `apps/web/src/n8n.ts`, `apps/web/src/n8n.test.ts`.
- `apps/web/src/settings.ts`: non-persisting address generator; drop the `ale@` suggestion.
- `apps/web/src/copy/admin.ts`, `apps/web/src/copy/parity.test.ts`.
- `apps/web/src/views/Facturen.tsx`, `apps/web/src/views/Koppelingen.tsx`, `apps/web/src/App.tsx` (one prop).
- Existing tests that pin old copy: `facturen-n8n.test.tsx`, `facturen-n8n-persistence.test.tsx`, `facturen-ui.test.tsx`, `facturen-holds.test.ts`, `koppelingen.test.tsx`, others found by the grep in Task 7.
- `docs/n8n/DOORSTUURADRES.md`, `docs/n8n/FACTUREN.md`.

## Verification commands (from the package.json files)

| What                                                   | Command                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| core tests                                             | `pnpm --filter @lavega/core test`                                                            |
| core typecheck (checks the `.js` JSDoc too, `checkJs`) | `pnpm --filter @lavega/core typecheck`                                                       |
| worker tests                                           | `pnpm --filter @lavega/email-worker test`                                                    |
| worker typecheck                                       | `pnpm --filter @lavega/email-worker typecheck`                                               |
| web tests                                              | `pnpm --filter @lavega/web test`                                                             |
| web typecheck                                          | `pnpm --filter @lavega/web typecheck`                                                        |
| one test file                                          | `pnpm --filter @lavega/web exec vitest run src/n8n.test.ts` (same shape for core and worker) |
| lint (repo root, `--max-warnings 0`)                   | `pnpm run lint`                                                                              |
| format check / fix                                     | `pnpm run format` / `pnpm exec oxfmt <files>`                                                |
| regenerate the workflow JSON                           | `pnpm run sync:n8n` ; check only: `pnpm run sync:n8n --check`                                |

The worker's `tsconfig` only includes `src`; its tests run under vitest without typecheck, as its own comment says. Say so in the report.

---

### Task 1: Capture the real Gmail confirmation (MANUAL, owner) and add the provisional fixture

**The shape of Gmail's confirmation mail is UNVERIFIED.** Nobody has captured one. The synthetic fixture below uses the commonly documented shape (From `forwarding-noreply@google.com`, subject `(#<digits>) Gmail Forwarding Confirmation - Receive Mail from <addr>`, body with `Confirmation code: <digits>`) and is a guess. The classifier is written to be driven by the fixture, and the Release task refuses to ship while only the synthetic one exists.

**Files:**

- Create: `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.SYNTHETIC.json`
- Create: `packages/core/src/n8n/__fixtures__/gmailConfirmation.ts`
- Owner creates: `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.json`

**Interfaces:**

- Produces: `GMAIL_CONFIRMATION_PAYLOAD: Record<string, unknown>` (an `InboundMailPayload`-shaped object, the n8n "E-mail binnen" `body`), `EXPECTED_CODE: string`, `FIXTURE_IS_REAL: boolean`.

- [ ] **Step 1: Owner captures the real mail (manual, ~5 minutes, an agent cannot do this)**

  The owner does this once, then tells the agent the file exists:
  1. In Gmail (a _different_ account than the production forwarding address's owner is fine): Settings, "Forwarding and POP/IMAP", "Add a forwarding address", paste the owner's own LaVega address (the one that routes to the live n8n).
  2. Gmail mails a confirmation to that address. It does not land in an inbox; it lands in n8n.
  3. In n8n open Executions, pick the latest run of the webhook "E-mail binnen", click that node, Output, JSON tab. Copy the value of `body` (the object with `to`, `queueKey`, `from`, `subject`, `text`, `html`, `attachments` ...).
  4. Save it as `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.json`.
  5. Redact the Gmail account's own address everywhere in `subject`, `text`, `html` (replace with `someone@gmail.com`) and the owner's forwarding address in `to` with `alexander-7f3a@invoices.lavega.dev`. **Do not touch** the sender, the subject layout, the label before the code, or the code digits.
  6. Add two keys at the top level (the classifier ignores unknown keys): `"_note": "REAL capture <date>, redacted"` and `"_expectedCode": "<the digits Gmail showed>"`.
  7. If the Gmail UI language is Dutch, repeat once with an English account (or vice versa) and save the second as `gmail-forwarding-confirmation.nl.json` / `.en.json`; Task 2 has a hook for it. One real capture is the minimum.

- [ ] **Step 2: Create the SYNTHETIC fixture**

  `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.SYNTHETIC.json`:

  ```json
  {
    "_note": "SYNTHETIC. Written from memory of Gmail's documented format, NOT captured. Shape is UNVERIFIED. Replace with gmail-forwarding-confirmation.json (real capture) before release.",
    "_expectedCode": "123456789",
    "to": "alexander-7f3a@invoices.lavega.dev",
    "queueKey": "alexander-7f3a",
    "from": "forwarding-noreply@google.com",
    "subject": "(#123456789) Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com",
    "date": "Wed, 21 Oct 2026 13:58:02 +0000",
    "messageId": "<synthetic-confirmation-1@mail.gmail.com>",
    "text": "someone@gmail.com has requested to automatically forward mail to your email address alexander-7f3a@invoices.lavega.dev.\n\nConfirmation code: 123456789\n\nTo allow someone@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5BSYNTHETIC%5D\n\nIf you do not approve of this request, please ignore this message.\n\nThanks for using Gmail!",
    "html": "",
    "auth": { "spf": "unknown", "dkim": "unknown", "dmarc": "unknown" },
    "attachments": []
  }
  ```

- [ ] **Step 3: Create the loader**

  `packages/core/src/n8n/__fixtures__/gmailConfirmation.ts`:

  ```ts
  import { existsSync, readFileSync } from "node:fs";

  /* Real capture wins; the synthetic one is only a stand-in. The classifier tests
   * read the payload and the expected code from here, so dropping the real file in
   * re-points every test at it with no code change. */
  const REAL = new URL("./gmail-forwarding-confirmation.json", import.meta.url);
  const SYNTHETIC = new URL("./gmail-forwarding-confirmation.SYNTHETIC.json", import.meta.url);

  export const FIXTURE_IS_REAL = existsSync(REAL);

  const raw = JSON.parse(readFileSync(FIXTURE_IS_REAL ? REAL : SYNTHETIC, "utf8")) as Record<
    string,
    unknown
  >;

  export const EXPECTED_CODE = String(raw._expectedCode);
  const { _note: _n, _expectedCode: _c, ...payload } = raw;
  export const GMAIL_CONFIRMATION_PAYLOAD: Record<string, unknown> = payload;
  ```

- [ ] **Step 4: Stage**

  ```bash
  git add packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.SYNTHETIC.json packages/core/src/n8n/__fixtures__/gmailConfirmation.ts
  ```

  If the owner has delivered the real file: also `git add packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.json`. Tasks 2 to 12 proceed on the synthetic file without waiting; only Task 12 blocks on the real one.

---

### Task 2: Classifier in `normalizeInboundMail.js`

**Files:**

- Modify: `packages/core/src/n8n/normalizeInboundMail.js` (typedef at ~87-93, function before `normalizeInboundMail` at ~176, return object at ~209-227, export at 230)
- Create: `packages/core/src/n8n/setupMail.test.ts`

**Interfaces:**

- Consumes: `asString`, `pickBody` already imported at the top of this file.
- Produces:
  - `SetupSignal = { kind: 'forwarding-confirmation' | 'setup-test', code: string }`
  - `classifySetupMail(mail: { from: unknown, subject: unknown, text: unknown }): SetupSignal | null` (exported)
  - `normalizeInboundMail(...)` result gains `setup: SetupSignal | null`; when `setup` is non-null, `ok === false` and `reason === ""`. `ok:false` is what makes the If-node "Iets te lezen?" (`$json.ok` true branch = Claude) send the mail to "Melding: zelf ophalen".

- [ ] **Step 1: Write the failing tests**

  `packages/core/src/n8n/setupMail.test.ts`:

  ```ts
  import { expect, test } from "vitest";
  import { classifySetupMail, normalizeInboundMail } from "./normalizeInboundMail.js";
  import {
    EXPECTED_CODE,
    FIXTURE_IS_REAL,
    GMAIL_CONFIRMATION_PAYLOAD,
  } from "./__fixtures__/gmailConfirmation.js";
  import { INBOUND_PLAIN_TEXT } from "./__fixtures__/inboundPayload.js";

  /* The Gmail confirmation tests read the fixture, never a string typed here.
   * FIXTURE_IS_REAL says which one it was. The shape of the SYNTHETIC one is a
   * guess; Task 12 of the plan refuses to ship while this is false. */
  test("which Gmail fixture is driving these tests", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[setupMail] Gmail confirmation fixture is ${FIXTURE_IS_REAL ? "REAL" : "SYNTHETIC"}`,
    );
    expect(typeof FIXTURE_IS_REAL).toBe("boolean");
  });

  test("a Gmail forwarding confirmation is recognised and yields only its code", () => {
    const m = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
    expect(m.setup).toEqual({ kind: "forwarding-confirmation", code: EXPECTED_CODE });
    // Routed away from Claude: the If-node sends ok:false to "Melding: zelf ophalen".
    expect(m.ok).toBe(false);
    expect(m.reason).toBe("");
  });

  test("the signal carries the code and nothing from the body, least of all a link", () => {
    const m = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
    expect(Object.keys(m.setup!).sort()).toEqual(["code", "kind"]);
    expect(JSON.stringify(m.setup)).not.toMatch(/https?:/);
  });

  test("a lookalike from another sender is NOT a confirmation and still reaches the model", () => {
    for (const from of [
      "forwarding-noreply@google.com.evil.example",
      "forwarding-noreply@gmail.com",
      "Google <forwarding-noreply@g00gle.com>",
      "evil@example.com",
    ]) {
      const m = normalizeInboundMail({ ...GMAIL_CONFIRMATION_PAYLOAD, from });
      expect(m.setup, from).toBeNull();
    }
  });

  test("a display-name From still matches when the address is Google's", () => {
    expect(
      classifySetupMail({
        from: "Gmail Team <Forwarding-NoReply@Google.com>",
        subject: "(#42) x",
        text: "Confirmation code: 42",
      }),
    ).toEqual({ kind: "forwarding-confirmation", code: "42" });
  });

  test("a code with letters, or longer than 20 digits, is rejected", () => {
    const base = { from: "forwarding-noreply@google.com", subject: "hello" };
    expect(classifySetupMail({ ...base, text: "Confirmation code: 12ab34" })).toBeNull();
    expect(classifySetupMail({ ...base, text: "Confirmation code: " + "1".repeat(21) })).toBeNull();
    expect(
      classifySetupMail({ ...base, text: "Confirmation code: " + "1".repeat(20) })?.code,
    ).toHaveLength(20);
    expect(classifySetupMail({ ...base, text: "no label and no digits at all" })).toBeNull();
  });

  test("two different codes in one mail are ambiguous and rejected, never guessed", () => {
    expect(
      classifySetupMail({
        from: "forwarding-noreply@google.com",
        subject: "(#111111) Gmail Forwarding Confirmation",
        text: "Confirmation code: 222222",
      }),
    ).toBeNull();
  });

  test("the Dutch Gmail wording is recognised (UNVERIFIED wording, written from memory)", () => {
    expect(
      classifySetupMail({
        from: "forwarding-noreply@google.com",
        subject: "Bevestiging voor doorsturen in Gmail",
        text: "Bevestigingscode: 987654321\n\nKlik op de link om te bevestigen.",
      }),
    ).toEqual({ kind: "forwarding-confirmation", code: "987654321" });
  });

  test("a mail whose subject is LaVega test <code> is a setup-test, code lowercased", () => {
    const m = normalizeInboundMail({ ...INBOUND_PLAIN_TEXT, subject: "LaVega test K3X9 factuur" });
    expect(m.setup).toEqual({ kind: "setup-test", code: "k3x9" });
    expect(m.ok).toBe(false);
  });

  test("forward prefixes do not hide a test subject", () => {
    for (const subject of [
      "Fwd: LaVega test ab12 invoice",
      "FW: LaVega test ab12",
      "Re: Fwd: lavega test ab12",
    ]) {
      expect(classifySetupMail({ from: "me@example.com", subject, text: "" }), subject).toEqual({
        kind: "setup-test",
        code: "ab12",
      });
    }
  });

  test("a test code must be exactly four [a-z0-9] characters", () => {
    for (const subject of [
      "LaVega test ab1",
      "LaVega test ab123",
      "LaVega test ab-1",
      "LaVega testab12",
    ]) {
      expect(classifySetupMail({ from: "x@y.nl", subject, text: "" }), subject).toBeNull();
    }
  });

  test("an ordinary invoice that mentions a test in its body still goes to the model", () => {
    const m = normalizeInboundMail({
      ...INBOUND_PLAIN_TEXT,
      subject: "Factuur HN-2026-4412",
      text: INBOUND_PLAIN_TEXT.text + "\n\nDit is geen LaVega test ab12, maar een echte factuur.",
    });
    expect(m.setup).toBeNull();
    expect(m.ok).toBe(true);
  });

  test("an ordinary invoice keeps setup null and its old behaviour", () => {
    const m = normalizeInboundMail(INBOUND_PLAIN_TEXT);
    expect(m.setup).toBeNull();
    expect(m.ok).toBe(true);
  });

  test("an empty payload has no setup signal and does not throw", () => {
    expect(normalizeInboundMail({}).setup).toBeNull();
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @lavega/core exec vitest run src/n8n/setupMail.test.ts`
  Expected: FAIL, `classifySetupMail is not a function` / `setup` undefined.

- [ ] **Step 3: Implement**

  In `normalizeInboundMail.js`, add after the `NormalizedInboundMessage` typedef (replace the typedef so it includes `setup`):

  ```js
  /**
   * Wat de klassifier van een setup-mail zegt: welk soort, en ALLEEN de code.
   * @typedef {{ kind: 'forwarding-confirmation'|'setup-test', code: string }} SetupSignal
   */

  /**
   * @typedef {import('./normalizeGmailMessage.js').NormalizedMessage & {
   *   deliveredTo: string,
   *   queueKey: string,
   *   senderChecks: SenderChecks,
   *   senderCheck: 'passed'|'failed'|'unknown',
   *   setup: SetupSignal|null
   * }} NormalizedInboundMessage
   */
  ```

  (delete the old `NormalizedInboundMessage` typedef block it replaces).

  Add before `normalizeInboundMail`:

  ```js
  /* SETUP-MAILS: het ene soort mail dat nooit naar het model gaat.
   *
   * 1. De bevestigingsmail van Gmail. Gmail stuurt een doorstuuradres pas
   *    door nadat de eigenaar een code uit een mail AAN DAT ADRES heeft ingevoerd.
   *    Die mail kwam tot nu toe in n8n's uitvoeringslog terecht. Hij wordt nu
   *    herkend en als code-only melding doorgegeven.
   * 2. De testmail "LaVega test <vier tekens>" uit de handleiding.
   *
   * ALLEEN DE CODE REIST MEE. De Worker kan afzenders niet controleren (#260),
   * dus iedereen kan een mail maken die op die van Google lijkt. Een link uit
   * zo'n mail tonen leent hem het vertrouwen van LaVega; een cijfercode die
   * nergens op past wordt door Gmail zelf geweigerd en kost niets.
   *
   * DE VORM VAN GOOGLES MAIL IS NIET HIER GEVERIFIEERD. Zie
   * __fixtures__/gmail-forwarding-confirmation*.json: de tests lezen die, niet
   * een tekst in dit bestand. */
  const GMAIL_CONFIRMATION_SENDER = "forwarding-noreply@google.com";
  const MAX_CODE_DIGITS = 20;
  /* 'fw' en 'fwd' en 're' vooraan: Gmail- en Outlook-regels laten het onderwerp
   * soms met een voorvoegsel doorgaan. Daarna precies vier tekens, en direct
   * daarna geen letter of cijfer meer, zodat "ab123" niet als "ab12" telt. */
  const TEST_SUBJECT = /^\s*(?:(?:re|fwd?)\s*:\s*)*lavega test ([a-z0-9]{4})(?![a-z0-9])/i;

  /**
   * Het kale adres uit "Naam <adres>" of uit een los adres, kleine letters.
   * @param {unknown} from
   * @returns {string}
   */
  function addressOf(from) {
    const s = asString(from).trim().toLowerCase();
    const m = s.match(/<([^<>\s]+)>\s*$/);
    return m ? m[1] : s;
  }

  /**
   * Alleen cijfers, 1 tot en met 20 stuks. Alles anders is "".
   * @param {unknown} v
   * @returns {string}
   */
  function digitsCode(v) {
    const s = asString(v);
    return /^[0-9]+$/.test(s) && s.length <= MAX_CODE_DIGITS ? s : "";
  }

  /**
   * De code uit onderwerp en/of tekst. Een gelabelde code met letters, een
   * onderwerpcode met letters, of twee verschillende codes: allemaal "".
   * @param {unknown} subject
   * @param {unknown} text
   * @returns {string}
   */
  function confirmationCodeOf(subject, text) {
    const labelled = asString(text).match(
      /(?:confirmation code|bevestigingscode)\s*:?\s*([A-Za-z0-9]+)/i,
    );
    const inSubject = asString(subject).match(/^\s*\(#([A-Za-z0-9]+)\)/);
    const fromBody = labelled ? digitsCode(labelled[1]) : "";
    const fromSubject = inSubject ? digitsCode(inSubject[1]) : "";
    if (labelled && !fromBody) return "";
    if (inSubject && !fromSubject) return "";
    if (fromBody && fromSubject && fromBody !== fromSubject) return "";
    return fromBody || fromSubject;
  }

  /**
   * @param {{ from: unknown, subject: unknown, text: unknown }} mail
   * @returns {SetupSignal|null}
   */
  function classifySetupMail(mail) {
    if (addressOf(mail.from) === GMAIL_CONFIRMATION_SENDER) {
      const code = confirmationCodeOf(mail.subject, mail.text);
      if (code) return { kind: "forwarding-confirmation", code: code };
    }
    const t = asString(mail.subject).match(TEST_SUBJECT);
    if (t) return { kind: "setup-test", code: t[1].toLowerCase() };
    return null;
  }
  ```

  In `normalizeInboundMail`, after `const senderChecks = readSenderChecks(p.auth);` add
  `const setup = classifySetupMail({ from: p.from, subject: p.subject, text: body.text });`
  and change the return object: `ok: setup ? false : ok,`, `reason: setup || ok ? "" : reasonForUnreadable(textChars, picked.skipped, attachments.length),`, and add `setup: setup,` as the last property. Add a short comment on `ok` that, for a setup mail, `false` means "not for the model" and not "unreadable". Export: `export { AUTH_RESULTS, readAuthResult, readSenderChecks, senderCheckOf, classifySetupMail, normalizeInboundMail };`.

  Note: `body.text` is the full text from `pickBody`, before the `MAX_TEXT_CHARS` slice, so a long confirmation still yields its code.

- [ ] **Step 4: Run tests and typecheck**

  Run: `pnpm --filter @lavega/core exec vitest run src/n8n/setupMail.test.ts src/n8n/normalizeInboundMail.test.ts` then `pnpm --filter @lavega/core typecheck`
  Expected: PASS. If an existing `normalizeInboundMail` test fails on a `toEqual` of the whole object, add `setup: null` there.

- [ ] **Step 5: Stage**

  ```bash
  git add packages/core/src/n8n/normalizeInboundMail.js packages/core/src/n8n/setupMail.test.ts
  ```

---

### Task 3: Code-only notice, adapter dispatch, regenerated workflow JSON

**Files:**

- Modify: `packages/core/src/n8n/claudeToLaVega.js` (`QueueNotice` typedef at ~83-95; new function before `export` at ~365)
- Modify: `packages/core/src/n8n/codeNodes.js` (`UNREADABLE_ADAPTER`, lines 254-285)
- Modify (generated): `docs/n8n/lavega-invoices.json`, `docs/n8n/lavega-facturen-workflow.json`
- Test: `packages/core/src/n8n/claudeToLaVega.test.ts`, `codeNodes.test.ts`, `pipeline.test.ts`

**Interfaces:**

- Consumes: `normalizeInboundMail(...)` result with `.setup` (Task 2).
- Produces: `noticeForSetup(msg): QueueNotice` where `msg` is a normalised inbound message with non-null `setup`. Result: `{ source, messageId, subject: "", from: "", receivedAt, kind: setup.kind, code, reason: "", mailUrl: "" } + provenanceOf(msg)`. `messageId` falls back to `"setup-" + kind + "-" + code` when empty.
- `claudeToLaVega.js` is the only source of the "Melding: zelf ophalen" node (`codeNodes.js:349-352`); `normalizeInboundMail.js` is **not** in that node, so `noticeForSetup` must not import from it.

- [ ] **Step 1: Write the failing tests**

  Append to `claudeToLaVega.test.ts` (adjust the import line to add `noticeForSetup`):

  ```ts
  test("noticeForSetup carries the kind and the code and nothing from the mail", () => {
    const n = noticeForSetup({
      source: "inbound-mail",
      messageId: "<abc@mail.gmail.com>",
      date: "Wed, 21 Oct 2026 13:58:02 +0000",
      setup: { kind: "forwarding-confirmation", code: "123456789" },
      deliveredTo: "alexander-7f3a@invoices.lavega.dev",
      queueKey: "alexander-7f3a",
      senderCheck: "unknown",
      senderChecks: { spf: "unknown", dkim: "unknown", dmarc: "unknown" },
    });
    expect(n).toMatchObject({
      kind: "forwarding-confirmation",
      code: "123456789",
      subject: "",
      from: "",
      reason: "",
      mailUrl: "",
      queueKey: "alexander-7f3a",
    });
    expect("amountCents" in n).toBe(false);
  });

  test("an empty Message-ID still yields a stable id, or addToQueue would drop the notice", () => {
    const base = {
      source: "inbound-mail",
      messageId: "",
      date: "",
      setup: { kind: "setup-test" as const, code: "k3x9" },
      deliveredTo: "a@invoices.lavega.dev",
      queueKey: "a",
    };
    expect(noticeForSetup(base).messageId).toBe("setup-setup-test-k3x9");
    expect(noticeForSetup(base).messageId).toBe(noticeForSetup(base).messageId);
  });
  ```

  Append to `codeNodes.test.ts` (it already imports `readFileSync`, `NODE_SPECS`; add a runner):

  ```ts
  /* Run a generated Code node the way n8n does: as a function body with $input. */
  function runNode(id: string, items: unknown[]) {
    const jsCode: string = node(id).parameters.jsCode;
    const fn = new Function("$input", jsCode);
    return fn({ all: () => items.map((json) => ({ json })) }) as any;
  }

  const MELDING = "b1000000-0000-4000-8000-000000000010";

  test('"Melding: zelf ophalen" turns a setup message into a code-only notice', () => {
    const out = runNode(MELDING, [
      {
        source: "inbound-mail",
        messageId: "<m1>",
        subject: "(#123456789) Gmail Forwarding Confirmation - someone@gmail.com",
        from: "forwarding-noreply@google.com",
        date: "d",
        reason: "",
        deliveredTo: "a-1@invoices.lavega.dev",
        queueKey: "a-1",
        senderCheck: "unknown",
        senderChecks: { spf: "unknown", dkim: "unknown", dmarc: "unknown" },
        setup: { kind: "forwarding-confirmation", code: "123456789" },
      },
    ]);
    const n = out[0].json.notices[0];
    expect(n.kind).toBe("forwarding-confirmation");
    expect(n.code).toBe("123456789");
    expect(n.subject).toBe("");
    expect(JSON.stringify(n)).not.toContain("someone@gmail.com");
    expect(out[0].json.processedIds).toEqual(["<m1>"]);
  });

  test('"Melding: zelf ophalen" still produces an unreadable notice when there is no setup', () => {
    const out = runNode(MELDING, [
      {
        source: "inbound-mail",
        messageId: "<m2>",
        subject: "s",
        from: "f",
        date: "d",
        reason: "Niets.",
      },
    ]);
    expect(out[0].json.notices[0].kind).toBe("unreadable");
  });
  ```

  Append to `pipeline.test.ts`:

  ```ts
  import { GMAIL_CONFIRMATION_PAYLOAD, EXPECTED_CODE } from "./__fixtures__/gmailConfirmation.js";
  import { noticeForSetup } from "./claudeToLaVega.js";

  test("both setup kinds reach the owner's queue key and never become a Claude request", () => {
    const confirmation = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
    const test1 = normalizeInboundMail({
      ...INBOUND_WITH_PDF,
      messageId: "<t1>",
      subject: "LaVega test k3x9 factuur",
    });
    const notices = [];
    for (const m of [confirmation, test1]) {
      // The If-node: ok:false never reaches "Bouw Claude-verzoek".
      expect(m.ok).toBe(false);
      expect(m.setup).not.toBeNull();
      notices.push(noticeForSetup(m as never));
    }
    const store: Record<string, unknown> = {};
    const result = addToQueue(
      store,
      { invoices: [], notices, processedIds: notices.map((n) => n.messageId) } as never,
      "2026-10-21T14:00:00.000Z",
    );
    expect(result.addedNotices).toBe(2);
    const byKey = store.noticesByKey as Record<string, { kind: string; code: string }[]>;
    expect(byKey["alexander-7f3a"].map((n) => [n.kind, n.code])).toEqual([
      ["forwarding-confirmation", EXPECTED_CODE],
      ["setup-test", "k3x9"],
    ]);
    expect(byKey[OWNER_KEY]).toBeUndefined();
  });

  test("Gmail resending the same confirmation does not duplicate the notice", () => {
    const m = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
    const n = noticeForSetup(m as never);
    const store: Record<string, unknown> = {};
    addToQueue(store, { invoices: [], notices: [n], processedIds: [] } as never, "t1");
    const again = addToQueue(
      store,
      { invoices: [], notices: [n], processedIds: [] } as never,
      "t2",
    );
    expect(again.addedNotices).toBe(0);
  });
  ```

  (`INBOUND_WITH_PDF`, `normalizeInboundMail`, `addToQueue`, `OWNER_KEY` are already imported in that file.)

- [ ] **Step 2: Run to verify they fail**

  Run: `pnpm --filter @lavega/core exec vitest run src/n8n/claudeToLaVega.test.ts src/n8n/codeNodes.test.ts src/n8n/pipeline.test.ts`
  Expected: FAIL (`noticeForSetup` missing; adapter has no dispatch).

- [ ] **Step 3: Implement `noticeForSetup`**

  In `claudeToLaVega.js` change the typedef's kind line and add `code`:

  ```js
   * @property {'notification'|'reminder'|'no-amount'|'unreadable'|'forwarding-confirmation'|'setup-test'} kind
   * @property {string} reason
   * @property {string} mailUrl
   * @property {string} [code]   alleen bij de twee setup-soorten: cijfers resp. vier tekens
  ```

  Add before the export:

  ```js
  /**
   * Een setup-mail (Gmail-bevestiging of testmail) als melding: ALLEEN soort en
   * code. Onderwerp en afzender blijven leeg met opzet: het onderwerp van Gmails
   * bevestiging bevat het Gmail-adres van de eigenaar, en wat niet nodig is gaat
   * niet mee. `messageId` valt terug op soort+code, want `addToQueue` slaat een
   * melding zonder id stilzwijgend over (queue.js) en dan wacht de handleiding
   * eeuwig.
   * @param {{source: string, messageId: string, date: string, setup: {kind: 'forwarding-confirmation'|'setup-test', code: string}} & ProvenanceInput} msg
   * @returns {QueueNotice}
   */
  function noticeForSetup(msg) {
    const kind = msg.setup.kind;
    const code = String(msg.setup.code);
    return Object.assign(
      /** @type {QueueNotice} */ ({
        source: msg.source,
        messageId: msg.messageId || "setup-" + kind + "-" + code,
        subject: "",
        from: "",
        receivedAt: String(msg.date || ""),
        kind: kind,
        code: code,
        reason: "",
        mailUrl: "",
      }),
      provenanceOf(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (msg))),
    );
  }
  ```

  Add `noticeForSetup,` to the export list.

- [ ] **Step 4: Implement the adapter dispatch**

  In `codeNodes.js` `UNREADABLE_ADAPTER` replace
  `"  notices.push(noticeForUnreadable({",` with
  `"  notices.push(m.setup ? noticeForSetup(m) : noticeForUnreadable({",`
  and update the header comment lines to add: `"// Ook de setup-mails (Gmail-bevestiging, testmail) komen hier uit: ok:false,",` `"// dus nooit naar het model. Alleen de code reist mee."`. The closing `"  }));"` stays.

- [ ] **Step 5: Regenerate the JSON and run everything**

  ```bash
  pnpm run sync:n8n
  pnpm run sync:n8n --check
  pnpm --filter @lavega/core test
  pnpm --filter @lavega/core typecheck
  pnpm --filter @lavega/web exec vitest run src/n8n-workflow.test.ts
  ```

  Expected: sync prints "Bijgewerkt: …" for **both** JSON files (two nodes each: "Normaliseer binnengekomen mail" and "Melding: zelf ophalen"), `--check` prints "n8n-code is bij", all tests PASS. `n8n-workflow.test.ts` requires the two JSONs to differ at exactly four known points; the sync writes identical code to both, so it must stay green. Topology is unchanged (no node or connection added).

- [ ] **Step 6: Stage**

  ```bash
  git add packages/core/src/n8n/claudeToLaVega.js packages/core/src/n8n/claudeToLaVega.test.ts packages/core/src/n8n/codeNodes.js packages/core/src/n8n/codeNodes.test.ts packages/core/src/n8n/pipeline.test.ts docs/n8n/lavega-invoices.json docs/n8n/lavega-facturen-workflow.json
  ```

---

### Task 4: Worker contract test for the confirmation mail

**Files:**

- Modify: `apps/email-worker/test/rawMail.ts` (append a raw MIME constant)
- Modify: `apps/email-worker/test/contract.test.ts` (add one test)

**Interfaces:**

- Consumes: `through(raw)` helper already in `contract.test.ts` (`buildPayload` + `parseMail` + `normalizeInboundMail`).
- Produces: `RAW_GMAIL_CONFIRMATION` (SYNTHETIC raw MIME).

The real capture (Task 1) is the n8n _payload_, not raw MIME, so the raw message here stays synthetic. What this test proves is the seam: a message with Google's From header survives `parseMail`, `buildPayload` (`addressOnly(mail.from || message.from)`, `handler.ts:193`) and `normalizeInboundMail` intact and classifies.

- [ ] **Step 1: Write the failing test**

  Append to `contract.test.ts` (add `RAW_GMAIL_CONFIRMATION` to the `./rawMail.js` import):

  ```ts
  test("a Gmail confirmation goes through the Worker and is recognised, code only (SYNTHETIC raw mail)", () => {
    const m = through(RAW_GMAIL_CONFIRMATION);
    expect(m.from).toBe("forwarding-noreply@google.com");
    expect(m.setup).toEqual({ kind: "forwarding-confirmation", code: "123456789" });
    expect(m.ok).toBe(false);
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @lavega/email-worker exec vitest run test/contract.test.ts`
  Expected: FAIL (`RAW_GMAIL_CONFIRMATION` undefined).

- [ ] **Step 3: Add the raw message**

  Append to `rawMail.ts`:

  ```ts
  /** SYNTHETIC. Gmail's forwarding-confirmation mail as RFC 5322, written from
   *  memory of the documented format. NOT a capture; the shape is UNVERIFIED. The
   *  classifier itself is driven by core's __fixtures__/gmail-forwarding-
   *  confirmation*.json; this one only proves the Worker passes the From header and
   *  the text through. */
  export const RAW_GMAIL_CONFIRMATION = [
    "From: Gmail Team <forwarding-noreply@google.com>",
    "To: alexander-7f3a@invoices.lavega.dev",
    "Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com",
    "Date: Wed, 21 Oct 2026 13:58:02 +0000",
    "Message-ID: <synthetic-confirmation-raw@mail.gmail.com>",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    "someone@gmail.com has requested to automatically forward mail to your email address alexander-7f3a@invoices.lavega.dev.",
    "",
    "Confirmation code: 123456789",
    "",
    "https://mail-settings.google.com/mail/vf-%5BSYNTHETIC%5D",
    "",
  ].join("\r\n");
  ```

- [ ] **Step 4: Run tests**

  Run: `pnpm --filter @lavega/email-worker test` and `pnpm --filter @lavega/email-worker typecheck`
  Expected: PASS. If `handler.test.ts` rejects the sender (spoof gate refuses `lavega.dev` impersonation only, not google.com, `spoofGate.ts:7-27`), no change is needed; if it does, stop and report: that would be a real defect in the spec's premise.

- [ ] **Step 5: Stage**

  ```bash
  git add apps/email-worker/test/rawMail.ts apps/email-worker/test/contract.test.ts
  ```

---

### Task 5: Web wire parsing of the two kinds

**Files:**

- Modify: `apps/web/src/n8n.ts` (imports ~line 17-20; `parseQueue` ~171-235; `FetchOutcome` ~94-101; `fetchQueue` return ~259)
- Test: `apps/web/src/n8n.test.ts` (new tests; update the two exact-equality assertions at ~118 and ~155-160)

**Interfaces:**

- Produces:
  - `type N8nSetupSignal = { kind: "forwarding-confirmation" | "setup-test"; code: string }`
  - `parseQueue(body)` now returns `{ rows, notices, setup: N8nSetupSignal[], dropped }` (or `null`)
  - `FetchOutcome` `ok` variant gains `setup: N8nSetupSignal[]`
- Deviation from the spec, deliberate: the two kinds do **not** enter `N8nNotice["kind"]` / `NOTICE_KINDS`. `N8nNotice` is persisted to the vault, rendered by `kindLabels[n.kind]` and listed under "Zelf ophalen"; adding the kinds there makes "a setup notice shown in the list" representable. A separate list makes it unrepresentable. The wire format is unchanged (both arrive in `notices`). Also: malformed setup signals are skipped silently, **not** counted in `dropped`. The spec says "into `dropped`, the way malformed rows are handled today", but today malformed _notices_ are skipped silently (`n8n.ts:154-158`) and `dropped` counts invoice rows only, rendered as "regel(s) misten een bedrag" (`copy/admin.ts:770`), which would be a wrong message for a setup mail.

- [ ] **Step 1: Write the failing tests**

  In `n8n.test.ts` change line ~118 to `toEqual({ rows: [], notices: [], setup: [], dropped: 0 })` and the `fetchQueue` ok-equality (~155-160) to include `setup: [],`. Append:

  ```ts
  test("setup notices are parsed into their own list and never into notices", () => {
    const parsed = parseQueue({
      invoices: [],
      notices: [
        { messageId: "a", kind: "forwarding-confirmation", code: "123456789" },
        { messageId: "b", kind: "setup-test", code: "k3x9" },
        { messageId: "c", kind: "unreadable", reason: "x", mailUrl: "" },
      ],
    })!;
    expect(parsed.setup).toEqual([
      { kind: "forwarding-confirmation", code: "123456789" },
      { kind: "setup-test", code: "k3x9" },
    ]);
    expect(parsed.notices.map((n) => n.kind)).toEqual(["unreadable"]);
    expect(parsed.dropped).toBe(0);
  });

  test("a malformed setup code is skipped, not trusted and not counted as a lost invoice", () => {
    const parsed = parseQueue({
      invoices: [],
      notices: [
        { messageId: "a", kind: "forwarding-confirmation", code: "12ab" },
        { messageId: "b", kind: "forwarding-confirmation", code: "1".repeat(21) },
        { messageId: "c", kind: "forwarding-confirmation" },
        { messageId: "d", kind: "setup-test", code: "K3X9" },
        { messageId: "e", kind: "setup-test", code: "k3x" },
        { messageId: "f", kind: "setup-test", code: "https://evil.example" },
      ],
    })!;
    expect(parsed.setup).toEqual([]);
    expect(parsed.dropped).toBe(0);
  });

  test("fetchQueue hands the setup signals through", async () => {
    const { impl } = fakeFetch(200, {
      invoices: [],
      notices: [{ messageId: "a", kind: "setup-test", code: "k3x9" }],
    });
    const out = await fetchQueue(impl);
    expect(out.kind === "ok" && out.setup).toEqual([{ kind: "setup-test", code: "k3x9" }]);
  });
  ```

  (An uppercase `K3X9` is rejected on purpose: the core classifier lowercases before the wire, so uppercase on the wire means something else wrote it.)

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @lavega/web exec vitest run src/n8n.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**

  In `n8n.ts` add `import { Option, Schema } from "effect";` below the existing imports, then (near `NOTICE_KINDS`):

  ```ts
  /** The two notices that are not mail to act on but signals for the forwarding
   *  guide. Same wire array as notices, a separate type on this side: they must
   *  never be persisted to the vault or listed under "Zelf ophalen". */
  export type N8nSetupSignal = {
    kind: "forwarding-confirmation" | "setup-test";
    code: string;
  };

  const SetupSignalSchema = Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("forwarding-confirmation"),
      code: Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/)),
    }),
    Schema.Struct({
      kind: Schema.Literal("setup-test"),
      code: Schema.String.check(Schema.isPattern(/^[a-z0-9]{4}$/)),
    }),
  ]);
  const decodeSetupSignal = Schema.decodeUnknownOption(SetupSignalSchema);

  function parseSetupSignals(body: unknown): N8nSetupSignal[] {
    const list = (body as { notices?: unknown }).notices;
    if (!Array.isArray(list)) return [];
    const out: N8nSetupSignal[] = [];
    for (const raw of list) {
      const decoded = Option.getOrNull(decodeSetupSignal(raw));
      if (decoded) out.push({ kind: decoded.kind, code: decoded.code });
    }
    return out;
  }
  ```

  Change `parseQueue`'s return type to `{ rows; notices; setup: N8nSetupSignal[]; dropped } | null` and its last line to `return { rows, notices: parseNotices(body), setup: parseSetupSignals(body), dropped };`. In `FetchOutcome` change the ok variant to `{ kind: "ok"; rows: N8nInvoiceRow[]; notices: N8nNotice[]; setup: N8nSetupSignal[]; dropped: number }` and `fetchQueue`'s final return to include `setup: parsed.setup`. If the exact `Schema.Union([...])` / `.check(Schema.isPattern(...))` spelling is rejected by the typechecker, read `repos/effect/LLMS.md` and fix the spelling; the behaviour above is what the tests pin. `parseNotices` is unchanged: it already ignores unknown kinds.

- [ ] **Step 4: Run tests and typecheck**

  Run: `pnpm --filter @lavega/web exec vitest run src/n8n.test.ts` then `pnpm --filter @lavega/web typecheck`
  Expected: PASS. Typecheck will flag any other construction of an `ok` outcome; add `setup: []` there.

- [ ] **Step 5: Stage**

  ```bash
  git add apps/web/src/n8n.ts apps/web/src/n8n.test.ts
  ```

---

### Task 6: Guide state and transitions (`forwardingGuide.ts`)

**Files:**

- Create: `apps/web/src/forwardingGuide.ts`
- Create: `apps/web/src/forwardingGuide.test.ts`

**Interfaces:**

- Consumes: `N8nSetupSignal` (Task 5).
- Produces (all exported):
  - constants `GMAIL_FORWARDING_URL`, `GMAIL_FILTERS_URL`, `OUTLOOK_COM_RULES_URL`, `OUTLOOK_WORK_RULES_URL`, `GMAIL_FILTER_QUERY`, `RULE_WORDS = "factuur, invoice, rekening, nota, receipt"`, `TEST_POLL_MS = 20_000`, `TEST_WINDOW_MS = 600_000`
  - `type GuideTab = "gmail" | "outlook"`
  - `type GuideState` (Schema type, below)
  - `emptyGuideState(): GuideState`
  - `loadGuideState(): GuideState`, `saveGuideState(s: GuideState): void` (never throw)
  - `readNowMs(): number`
  - `newTestCode(rand?: () => number): string` (4 chars `[a-z0-9]`, no ambiguous characters)
  - `testSubject(code: string, locale: "nl" | "en"): string` (`LaVega test <code> factuur|invoice`)
  - `startTest(s, code, nowMs): GuideState`
  - `applySignals(s, signals: readonly N8nSetupSignal[], nowMs): GuideState`
  - `toggleTick(s, id: string, nowMs): GuideState`; `setTab(s, tab): GuideState`
  - `testStatus(s, nowMs): "none" | "pending" | "passed" | "passed-other-code" | "timed-out"`
  - `isPollingActive(s, nowMs): boolean`

VERIFY marker: `OUTLOOK_COM_RULES_URL` and `OUTLOOK_WORK_RULES_URL` are unverified until Task 9.

- [ ] **Step 1: Write the failing tests**

  `apps/web/src/forwardingGuide.test.ts`:

  ```ts
  import { afterEach, beforeEach, expect, test } from "vitest";
  import {
    GMAIL_FILTER_QUERY,
    TEST_WINDOW_MS,
    applySignals,
    emptyGuideState,
    isPollingActive,
    loadGuideState,
    newTestCode,
    saveGuideState,
    startTest,
    testStatus,
    testSubject,
    toggleTick,
  } from "./forwardingGuide";

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("the Gmail filter search is the spec's, verbatim", () => {
    expect(GMAIL_FILTER_QUERY).toBe(
      "has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)",
    );
  });

  test("a test subject starts with the core classifier's prefix and carries a filter word", () => {
    expect(testSubject("k3x9", "nl")).toBe("LaVega test k3x9 factuur");
    expect(testSubject("k3x9", "en")).toBe("LaVega test k3x9 invoice");
  });

  test("newTestCode is four characters from an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) expect(newTestCode()).toMatch(/^[a-km-z2-9]{4}$/);
    expect(newTestCode(() => 0)).toBe("aaaa");
  });

  test("a confirmation code is remembered, and the latest one wins", () => {
    let s = emptyGuideState();
    s = applySignals(s, [{ kind: "forwarding-confirmation", code: "111" }], 1000);
    s = applySignals(s, [{ kind: "forwarding-confirmation", code: "222" }], 2000);
    expect(s.confirmation).toEqual({ code: "222", receivedAtMs: 2000 });
  });

  test("a test passes with the same code", () => {
    let s = startTest(emptyGuideState(), "k3x9", 0);
    expect(testStatus(s, 1000)).toBe("pending");
    s = applySignals(s, [{ kind: "setup-test", code: "k3x9" }], 5000);
    expect(testStatus(s, 6000)).toBe("passed");
    expect(s.passedAtMs).toBe(5000);
  });

  test("a test with another code counts as received but says so", () => {
    let s = startTest(emptyGuideState(), "k3x9", 0);
    s = applySignals(s, [{ kind: "setup-test", code: "zzzz" }], 5000);
    expect(testStatus(s, 6000)).toBe("passed-other-code");
    expect(s.passedAtMs).toBe(5000);
  });

  test("a stray test mail with no test started still proves forwarding works", () => {
    const s = applySignals(emptyGuideState(), [{ kind: "setup-test", code: "k3x9" }], 7000);
    expect(s.passedAtMs).toBe(7000);
    expect(testStatus(s, 8000)).toBe("none");
  });

  test("without a result the test times out after ten minutes, and polling stops", () => {
    const s = startTest(emptyGuideState(), "k3x9", 0);
    expect(isPollingActive(s, TEST_WINDOW_MS)).toBe(true);
    expect(testStatus(s, TEST_WINDOW_MS + 1)).toBe("timed-out");
    expect(isPollingActive(s, TEST_WINDOW_MS + 1)).toBe(false);
  });

  test("a result that arrives after the window, or after a reload, still counts", () => {
    let s = startTest(emptyGuideState(), "k3x9", 0);
    s = applySignals(s, [{ kind: "setup-test", code: "k3x9" }], TEST_WINDOW_MS * 5);
    expect(testStatus(s, TEST_WINDOW_MS * 6)).toBe("passed");
  });

  test("ticking Gmail step 1 starts waiting for the code; the code ends the wait", () => {
    let s = toggleTick(emptyGuideState(), "gmail:1", 100);
    expect(s.ticks).toContain("gmail:1");
    expect(isPollingActive(s, 200)).toBe(true);
    s = applySignals(s, [{ kind: "forwarding-confirmation", code: "9" }], 300);
    expect(isPollingActive(s, 400)).toBe(false);
    s = toggleTick(s, "gmail:1", 500);
    expect(s.ticks).not.toContain("gmail:1");
  });

  test("the code wait also ends after ten minutes", () => {
    const s = toggleTick(emptyGuideState(), "gmail:1", 0);
    expect(isPollingActive(s, TEST_WINDOW_MS + 1)).toBe(false);
  });

  test("state survives a save and a load", () => {
    const s = startTest(emptyGuideState(), "k3x9", 123);
    saveGuideState(s);
    expect(loadGuideState()).toEqual(s);
  });

  test("garbage in localStorage loads as the empty state and does not throw", () => {
    for (const junk of ["not json", "{}", '{"tab":"fax"}', "null", '{"test":{"code":1}}']) {
      localStorage.setItem("lavega.forwardingGuide.v1", junk);
      expect(loadGuideState(), junk).toEqual(emptyGuideState());
    }
  });

  test("a blocked localStorage does not throw on load or save", () => {
    const original = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(loadGuideState()).toEqual(emptyGuideState());
      expect(() => saveGuideState(emptyGuideState())).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = originalSet;
    }
  });
  ```

  Add `// @vitest-environment jsdom` as the first line (localStorage).

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @lavega/web exec vitest run src/forwardingGuide.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

  `apps/web/src/forwardingGuide.ts`:

  ```ts
  import { DateTime, Option, Schema } from "effect";
  import type { N8nSetupSignal } from "./n8n.js";

  /* The state of the forwarding guide. Local to this browser on purpose: ticks are
   * a memory aid, and the ONLY proven state is a passed test (passedAtMs). Pure
   * functions on a plain value; the component owns the React state. */

  export const GMAIL_FORWARDING_URL = "https://mail.google.com/mail/u/0/#settings/fwdandpop";
  export const GMAIL_FILTERS_URL = "https://mail.google.com/mail/u/0/#settings/filters";
  // VERIFY (plan Task 9): both Outlook deep links are unconfirmed.
  export const OUTLOOK_COM_RULES_URL = "https://outlook.live.com/mail/0/options/mail/rules";
  export const OUTLOOK_WORK_RULES_URL = "https://outlook.office.com/mail/options/mail/rules";

  /** Lives here, not in copy: the English copy tree may not contain Dutch words
   *  (copy/parity.test.ts bans "rekening"), and this is a search expression. */
  export const GMAIL_FILTER_QUERY =
    "has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)";
  export const RULE_WORDS = "factuur, invoice, rekening, nota, receipt";

  export const TEST_POLL_MS = 20_000;
  export const TEST_WINDOW_MS = 10 * 60 * 1000;
  const STORAGE_KEY = "lavega.forwardingGuide.v1";

  export type GuideTab = "gmail" | "outlook";

  const GuideStateSchema = Schema.Struct({
    tab: Schema.Literals(["gmail", "outlook"]),
    ticks: Schema.Array(Schema.String),
    codeWaitStartedAtMs: Schema.NullOr(Schema.Number),
    confirmation: Schema.NullOr(
      Schema.Struct({ code: Schema.String, receivedAtMs: Schema.Number }),
    ),
    test: Schema.NullOr(
      Schema.Struct({
        code: Schema.String,
        startedAtMs: Schema.Number,
        receivedAtMs: Schema.NullOr(Schema.Number),
        receivedCode: Schema.NullOr(Schema.String),
      }),
    ),
    passedAtMs: Schema.NullOr(Schema.Number),
  });
  export type GuideState = Schema.Schema.Type<typeof GuideStateSchema>;
  const decodeState = Schema.decodeUnknownOption(GuideStateSchema);

  export function emptyGuideState(): GuideState {
    return {
      tab: "gmail",
      ticks: [],
      codeWaitStartedAtMs: null,
      confirmation: null,
      test: null,
      passedAtMs: null,
    };
  }

  export function readNowMs(): number {
    return DateTime.toEpochMillis(DateTime.nowUnsafe());
  }

  export function loadGuideState(): GuideState {
    try {
      const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyGuideState();
      return Option.getOrElse(decodeState(JSON.parse(raw)), emptyGuideState);
    } catch {
      return emptyGuideState();
    }
  }

  export function saveGuideState(state: GuideState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* blocked or full: the guide still works for this session */
    }
  }

  const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1: it is typed into a subject

  export function newTestCode(
    rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  ): string {
    let out = "";
    for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    return out;
  }

  /** `LaVega test <code>` is what core's classifier anchors on. The trailing word
   *  is one of the filter words so the user's own Gmail filter or Outlook rule
   *  matches the self-sent mail (a PDF is still required by the filter). */
  export function testSubject(code: string, locale: "nl" | "en"): string {
    return `LaVega test ${code} ${locale === "nl" ? "factuur" : "invoice"}`;
  }

  export function startTest(state: GuideState, code: string, nowMs: number): GuideState {
    return { ...state, test: { code, startedAtMs: nowMs, receivedAtMs: null, receivedCode: null } };
  }

  export function applySignals(
    state: GuideState,
    signals: readonly N8nSetupSignal[],
    nowMs: number,
  ): GuideState {
    let next = state;
    for (const s of signals) {
      if (s.kind === "forwarding-confirmation") {
        next = { ...next, confirmation: { code: s.code, receivedAtMs: nowMs } };
      } else {
        const pending = next.test && next.test.receivedAtMs === null ? next.test : null;
        next = {
          ...next,
          passedAtMs: nowMs,
          test: pending ? { ...pending, receivedAtMs: nowMs, receivedCode: s.code } : next.test,
        };
      }
    }
    return next;
  }

  export function toggleTick(state: GuideState, id: string, nowMs: number): GuideState {
    const on = state.ticks.includes(id);
    const ticks = on ? state.ticks.filter((t) => t !== id) : [...state.ticks, id];
    if (id !== "gmail:1") return { ...state, ticks };
    return { ...state, ticks, codeWaitStartedAtMs: on ? null : nowMs };
  }

  export function setTab(state: GuideState, tab: GuideTab): GuideState {
    return { ...state, tab };
  }

  export type TestStatus = "none" | "pending" | "passed" | "passed-other-code" | "timed-out";

  export function testStatus(state: GuideState, nowMs: number): TestStatus {
    const t = state.test;
    if (!t) return "none";
    if (t.receivedAtMs !== null) return t.receivedCode === t.code ? "passed" : "passed-other-code";
    return nowMs - t.startedAtMs > TEST_WINDOW_MS ? "timed-out" : "pending";
  }

  function waitingForCode(state: GuideState, nowMs: number): boolean {
    const since = state.codeWaitStartedAtMs;
    if (since === null) return false;
    if (state.confirmation && state.confirmation.receivedAtMs >= since) return false;
    return nowMs - since <= TEST_WINDOW_MS;
  }

  /** Fetch every TEST_POLL_MS only while there is something to wait for. */
  export function isPollingActive(state: GuideState, nowMs: number): boolean {
    return testStatus(state, nowMs) === "pending" || waitingForCode(state, nowMs);
  }
  ```

  Fix `newTestCode`'s default-parameter line with `pnpm exec oxfmt` (it is long). The default must not use `Math.random`.

- [ ] **Step 4: Run tests and typecheck**

  Run: `pnpm --filter @lavega/web exec vitest run src/forwardingGuide.test.ts` then `pnpm --filter @lavega/web typecheck`
  Expected: PASS. The "garbage" test includes `'{"test":{"code":1}}'`, which must decode to `None` (code is a number).

- [ ] **Step 5: Stage**

  ```bash
  git add apps/web/src/forwardingGuide.ts apps/web/src/forwardingGuide.test.ts
  ```

---

### Task 7: Rewrite the untrue and internal copy on Facturen (spec section 6.1 to 6.3) and add the no-internals gate

**Files:**

- Modify: `apps/web/src/copy/admin.ts` (NL `nlFacturen` 642-900, EN `enFacturen` 1220-1476, `nlGaps`/`enGaps` 16-32; type `FacturenCopy` 52-288)
- Modify: `apps/web/src/copy/parity.test.ts` (new gate)
- Modify: `apps/web/src/views/Facturen.tsx:929` (`gateNote` call)
- Modify: existing tests that pin old copy (found in Step 1)

**Interfaces:**

- Produces: `forms.auto.gateNote: string` (was `(entityCount: number) => string`).

- [ ] **Step 1: Write the failing gate, then list what it flags**

  Append to `copy/parity.test.ts` (it already has `strings()` with the function-probing `PROBES`, `adminCopy`, `test`, `expect`):

  ```ts
  /* A tester must never read the name of our plumbing. The allowlist is EMPTY on
   * purpose: if a legitimate use turns up, add it HERE with a reason, not by
   * loosening the pattern. */
  const INTERNALS = /n8n|webhook|messageid|workflow/i;
  const INTERNALS_ALLOWLIST: string[] = [];

  test.each(["nl", "en"] as const)(
    "%s facturen and koppelingen copy names no internals",
    (lang) => {
      const tree = { facturen: adminCopy[lang].facturen, koppelingen: adminCopy[lang].koppelingen };
      const hits = strings(tree)
        .filter(([k, v]) => INTERNALS.test(v) && !INTERNALS_ALLOWLIST.includes(k))
        .map(([k, v]) => `${k}: ${v}`);
      expect(hits).toEqual([]);
    },
  );
  ```

  Run: `pnpm --filter @lavega/web exec vitest run src/copy/parity.test.ts`
  Expected: FAIL, listing roughly 45 strings per language (gap strings, `n8nNotices.*`, `queue.eyebrow`, `queue.warningBody`, the nine `*AriaLabel (n8n)`, `notices.eyebrow/noReasonFallback/noLinkFallback`, `pullIntro`, `fetchButton`, and in Koppelingen the "wachtrij"/"queue" ones are not banned words but are rewritten in Task 8).

- [ ] **Step 2: Apply the rewrites**

  Edit `admin.ts` so the values below are exactly these. Keys not listed are unchanged. `${…}` placeholders stay as in the existing templates. Both languages in the same edit.

  | Key (under `facturen`, plus `nlGaps`/`enGaps`)                                                                 | NL                                                                                                                                                                                                                                                                                                                  | EN                                                                                                                                                                                                                                                                                    |
  | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `gaps["due-date"]` (also `queue.holds.gaps`)                                                                   | `Vul een vervaldatum in — LaVega vond er geen.`                                                                                                                                                                                                                                                                     | `Fill in a due date — LaVega found none.`                                                                                                                                                                                                                                             |
  | `gaps.currency`                                                                                                | `Vul de valuta in — LaVega las er geen, en gokt geen euro's.`                                                                                                                                                                                                                                                       | `Fill in the currency — LaVega read none, and does not assume euros.`                                                                                                                                                                                                                 |
  | `head.eyebrow`                                                                                                 | `Elke factuur wacht op jouw bevestiging — LaVega boekt niets zelf.`                                                                                                                                                                                                                                                 | `Every invoice waits for your confirmation — LaVega books nothing by itself.`                                                                                                                                                                                                         |
  | `forms.auto.pullIntro(minutes)`                                                                                | `LaVega kijkt of er facturen zijn binnengekomen zodra je dit scherm opent, en daarna elke ${minutes} minuten.`                                                                                                                                                                                                      | `LaVega checks for new invoices when you open this screen, then every ${minutes} minutes.`                                                                                                                                                                                            |
  | `forms.auto.gateNote` (now a plain string, drop the entity branches)                                           | `Elke factuur wacht op jouw bevestiging — LaVega boekt niets zelf.`                                                                                                                                                                                                                                                 | `Every invoice waits for your confirmation — LaVega books nothing by itself.`                                                                                                                                                                                                         |
  | `forms.auto.fetchButton`                                                                                       | `Nieuwe facturen ophalen`                                                                                                                                                                                                                                                                                           | `Check for new invoices`                                                                                                                                                                                                                                                              |
  | `n8nNotices.notConfigured`                                                                                     | `Nog niet ingesteld: het ophalen van facturen staat op de server niet aan. Er is niets opgehaald.`                                                                                                                                                                                                                  | `Not set up yet: invoice fetching is not switched on for this server. Nothing was fetched.`                                                                                                                                                                                           |
  | `n8nNotices.unauthorized.detail`                                                                               | `Er is niets van je mailbox gehaald; je facturen zijn onaangeroerd.`                                                                                                                                                                                                                                                | `Nothing was taken from your inbox; your invoices are untouched.`                                                                                                                                                                                                                     |
  | `n8nNotices.unauthorized.detailSummary`                                                                        | `Wat dit betekent`                                                                                                                                                                                                                                                                                                  | `What this means`                                                                                                                                                                                                                                                                     |
  | `n8nNotices.httpError(status)`                                                                                 | `Ophalen lukt nu niet (status ${status}). Er is niets verloren; probeer het straks opnieuw.`                                                                                                                                                                                                                        | `Couldn't fetch right now (status ${status}). Nothing was lost — try again shortly.`                                                                                                                                                                                                  |
  | `n8nNotices.network.detail`                                                                                    | `Dit is een verbindingsprobleem met LaVega zelf. Er is niets van je mailbox gehaald.`                                                                                                                                                                                                                               | `This is a connection problem with LaVega itself. Nothing was taken from your inbox.`                                                                                                                                                                                                 |
  | `n8nNotices.unreadable`                                                                                        | `Het antwoord van de server was niet te lezen. Er is niets overgenomen — en omdat het ophalen de lijst op de server al geleegd kan hebben, kan een regel verloren zijn.`                                                                                                                                            | `The server's response could not be read. Nothing was taken over — and because fetching may already have cleared the list on the server, a row may be lost.`                                                                                                                          |
  | `n8nNotices.pendingSaveFailed.detail`                                                                          | `De server heeft zijn eigen kopie van deze regels al gewist — dit tabblad is nu de enige plek waar ze nog bestaan. Ze staan hieronder zodat je ze niet kwijtraakt, maar opslaan in de kluis is mislukt. Probeer het opnieuw (bijvoorbeeld door de kluis te ontgrendelen) voordat je dit tabblad sluit of herlaadt.` | `The server has already deleted its own copy of these rows — this tab is now the only place they still exist. They are shown below so you don't lose them, but saving them to the vault failed. Try again (for example by unlocking the vault) before closing or reloading this tab.` |
  | `n8nNotices.emptyQueue`                                                                                        | `Er waren geen nieuwe facturen. Dat is geen bevestiging dat er niets is binnengekomen.`                                                                                                                                                                                                                             | `There were no new invoices. That is not confirmation that nothing arrived.`                                                                                                                                                                                                          |
  | `n8nNotices.nothingNew`                                                                                        | `Niets nieuws: alles wat binnenkwam was hier al afgehandeld.`                                                                                                                                                                                                                                                       | `Nothing new: everything that arrived was already handled here.`                                                                                                                                                                                                                      |
  | `n8nNotices.fetched(n)`                                                                                        | `${n} ${n === 1 ? "factuur" : "facturen"} opgehaald. Ze staan niet meer op de server.`                                                                                                                                                                                                                              | `${n} ${n === 1 ? "invoice" : "invoices"} fetched. They are no longer on the server.`                                                                                                                                                                                                 |
  | `n8nNotices.autoBooked(n)`                                                                                     | `${n} ${n === 1 ? "factuur is" : "facturen zijn"} zonder jouw klik geboekt. Met één klik draai je dat terug.`                                                                                                                                                                                                       | `${n} ${n === 1 ? "invoice was" : "invoices were"} booked without your click. One click undoes that.`                                                                                                                                                                                 |
  | `n8nNotices.duplicatesSkipped(n)`                                                                              | `${n} regel(s) kende LaVega al en worden niet opnieuw aangeboden.`                                                                                                                                                                                                                                                  | `${n} row(s) LaVega already knew and are not offered again.`                                                                                                                                                                                                                          |
  | `n8nNotices.dropped(n)`                                                                                        | `${n} regel(s) misten een kenmerk of een bedrag en zijn niet overgenomen — die staan niet in LaVega en niet meer op de server.`                                                                                                                                                                                     | `${n} row(s) were missing an identifier or an amount and were not taken over — they are not in LaVega and no longer on the server.`                                                                                                                                                   |
  | `queue.eyebrow(n)`                                                                                             | `uit je mailbox · ${n}`                                                                                                                                                                                                                                                                                             | `from your inbox · ${n}`                                                                                                                                                                                                                                                              |
  | `queue.warningBody(n)`                                                                                         | ` Het ophalen leegt de lijst op de server: nog eens ophalen levert deze ${n} ${n === 1 ? "regel" : "regels"} niet terug. Ze staan veilig in je kluis tot je ze bevestigt of verwerpt.`                                                                                                                              | ` Fetching clears the list on the server: fetching again will not bring these ${n} ${n === 1 ? "row" : "rows"} back. They are kept safe in your vault until you confirm or reject them.`                                                                                              |
  | `queue.holds.senderUnchecked`                                                                                  | `LaVega kan bij deze mail niet nagaan wie de afzender is, dus hij wacht op jou. Controleer hem en bevestig.`                                                                                                                                                                                                        | `LaVega can't verify who sent this mail, so it waits for you. Check it and confirm.`                                                                                                                                                                                                  |
  | `queue.*AriaLabel` (entity, direction, counterparty, invoiceNumber, issueDate, dueDate, amount, currency, vat) | label + ` (te bevestigen)`                                                                                                                                                                                                                                                                                          | label + ` (to confirm)`                                                                                                                                                                                                                                                               |
  | `notices.eyebrow(n)`                                                                                           | `uit je mailbox · ${n}`                                                                                                                                                                                                                                                                                             | `from your inbox · ${n}`                                                                                                                                                                                                                                                              |
  | `notices.noReasonFallback`                                                                                     | `Er is geen reden meegegeven.`                                                                                                                                                                                                                                                                                      | `No reason was given.`                                                                                                                                                                                                                                                                |
  | `notices.noLinkFallback`                                                                                       | `Er is geen link meegegeven; zoek de mail op het onderwerp.`                                                                                                                                                                                                                                                        | `No link was included; search your mail by the subject.`                                                                                                                                                                                                                              |
  | `list.autoBadgeTitle`                                                                                          | `Deze factuur is eerder zonder jouw klik geboekt. Met Terugdraaien zet je hem op geannuleerd.`                                                                                                                                                                                                                      | `This invoice was booked earlier without your click. Undo sets it to cancelled.`                                                                                                                                                                                                      |

  Notes for the executor:
  - The warning body at old `admin.ts:809` claimed "herladen of vergrendelen wist ze". That is **false**: pending rows are written to the vault (`Facturen.tsx` `putPendingInvoices`) and restored on unlock (`App.tsx:585-599`). The new body states what is true. The lead `warningLead` ("Let op — dit is de enige kopie.") stays.
  - The aria suffix replaces `(n8n)` with a disambiguator rather than deleting it, because the manual form on the same screen uses the same bare labels ("Relatie", "Bedrag"); two controls with one accessible name is worse.
  - `holds.senderForwarded/senderFailed/entityAmbiguous/incomplete/overCeiling` are unchanged: they are true statements and unreachable today (`checks` are always `unknown`); the spec only asks to stop promising. `autoBookDecision` is not touched.
  - Update the type comment above `forms.auto.gateNote` and the `FacturenCopy` entry to `gateNote: string`. In `Facturen.tsx:929` change `c.forms.auto.gateNote(entities.length)` to `c.forms.auto.gateNote`.
  - EN strings must stay clear of the Dutch substrings in `parity.test.ts` (`niet`, `geen`, `wordt`, `voor de`, `van de`, `maand`, `rekening`, `uitgaven`, `jouw`, `deze`, `nog geen`, `betaald`, `bedrag`, `opnieuw`). The strings above are checked against that list.

- [ ] **Step 3: Fix the tests that pin the old copy**

  Run: `grep -rn "Ophalen uit n8n\|Fetch from n8n\|(n8n)\|uit n8n\|from n8n\|geverifieerde afzender\|verified sender\|n8n gaf\|n8n heeft\|n8n leegt\|SPF/DKIM-controle" apps/web/src --include='*.test.*'`
  Update each hit to the new strings from the table (button `Nieuwe facturen ophalen`; aria labels `Relatie (te bevestigen)` etc.; the two assertions in `facturen-n8n.test.tsx` that read `dit is de enige kopie` and `nog eens ophalen levert deze 1 regel niet terug` both still hold because the new lead and body keep those phrases). Prefer importing the string from `adminCopy` over retyping it.

- [ ] **Step 4: Run**

  ```bash
  pnpm --filter @lavega/web exec vitest run src/copy src/facturen-n8n.test.tsx src/facturen-n8n-persistence.test.tsx src/facturen-ui.test.tsx src/facturen-holds.test.ts src/n8n.test.ts
  pnpm --filter @lavega/web typecheck
  ```

  Expected: PASS, including both `names no internals` gates and `parity`.

- [ ] **Step 5: Stage**

  ```bash
  git add apps/web/src/copy/admin.ts apps/web/src/copy/parity.test.ts apps/web/src/views/Facturen.tsx apps/web/src/facturen-n8n.test.tsx apps/web/src/facturen-n8n-persistence.test.tsx apps/web/src/facturen-ui.test.tsx apps/web/src/facturen-holds.test.ts
  ```

  (stage any other test file Step 3 touched.)

---

### Task 8: Koppelingen, one button to create the address (spec section 6.4)

**Files:**

- Modify: `apps/web/src/settings.ts` (~262-345): remove `SUGGESTED_INVOICE_FORWARD_ADDRESS`; add `generateInvoiceForwardAddress()`
- Modify: `apps/web/src/views/Koppelingen.tsx`, `apps/web/src/copy/admin.ts` (`KoppelingenCopy` 574-632, `nlKoppelingen` 1181-1218, `enKoppelingen` 1759-1795), `apps/web/src/App.tsx:1783`
- Test: `apps/web/src/koppelingen.test.tsx`

**Interfaces:**

- Consumes: `recordForwardAddress(localPart, fetchImpl): Promise<ForwardAddressWriteOutcome>` (`n8n.ts:298`).
- Produces: `generateInvoiceForwardAddress(makeSuffix?): string` (does **not** persist; `ensureInvoiceForwardAddress` stays for existing callers/tests); `Koppelingen` prop `onNavigate?: (view: View) => void`.

Behaviour (requirements):

1. No local address **and** the server holds no address: one primary button "Maak mijn factuuradres" generates `lavega-<10 chars>@invoices.lavega.dev`, POSTs its local part, and **only on `stored`** writes localStorage and shows it. On `taken` (409) generate a new one, up to 3 attempts. Any other failure shows `createFailed` and writes nothing locally.
2. A secondary text button "Eigen adres gebruiken" reveals today's typed-input flow (operator path). The input is hidden until clicked, unless an address already exists.
3. **No local address but the server already holds one** (second browser): do **not** offer "Maak mijn factuuradres" (it would replace a live address with a new one, and mail to the old one would pile up unseen). Show the existing "Nu actief" line and only the "Eigen adres gebruiken" path.
4. With an address set: a link/button "Automatisch doorsturen instellen →" that calls `onNavigate?.("facturen")`.
5. The `ale@…` suggestion, its tradeoff line, and the "Genereer een willekeurig adres" button are removed.

- [ ] **Step 1: Write the failing tests** (in `koppelingen.test.tsx`; reuse its `fakeFetch`, `noneFetch`, `render`, `click`, `byText`)

  ```ts
  test("an empty state offers ONE create button, and no personal alias", async () => {
    const c = await render(noneFetch().impl);
    expect(adminCopy.nl.koppelingen.forwardAddress.createButton).toBe("Maak mijn factuuradres");
    byText("button", "Maak mijn factuuradres");
    expect(c.textContent).not.toContain("ale@");
    expect(c.textContent).not.toContain("Cloudflare");
    expect(c.textContent).not.toContain("Genereer een willekeurig adres");
    byText("button", "Eigen adres gebruiken");
  });

  test("creating generates an address AND records it on the server in one step", async () => {
    const f = fakeFetch({
      get: () => ({ localPart: null }),
      post: (lp) => ({ status: 200, body: { localPart: lp } }),
    });
    const c = await render(f.impl);
    await clickAsync(byText("button", "Maak mijn factuuradres"));
    const posts = f.calls.filter((x) => x.method === "POST");
    expect(posts).toHaveLength(1);
    expect(getInvoiceForwardAddress()).toBe(`${posts[0].localPart}@invoices.lavega.dev`);
    expect(posts[0].localPart).toMatch(/^lavega-[a-z0-9]{10}$/);
    expect((c.querySelector('[aria-label="Doorstuuradres"]') as HTMLInputElement).value).toBe(
      getInvoiceForwardAddress(),
    );
  });

  test("a 409 tries a fresh address, and a persistent failure stores nothing locally", async () => {
    let n = 0;
    const f = fakeFetch({
      get: () => ({ localPart: null }),
      post: () => (++n < 2 ? { status: 409, body: {} } : { status: 200, body: { localPart: "x" } }),
    });
    await render(f.impl);
    await clickAsync(byText("button", "Maak mijn factuuradres"));
    expect(f.calls.filter((x) => x.method === "POST")).toHaveLength(2);

    localStorage.clear();
    const bad = fakeFetch({
      get: () => ({ localPart: null }),
      post: () => ({ status: 500, body: {} }),
    });
    const c = await render(bad.impl);
    await clickAsync(byText("button", "Maak mijn factuuradres"));
    expect(getInvoiceForwardAddress()).toBe("");
    expect(c.textContent).toContain(adminCopy.nl.koppelingen.forwardAddress.createFailed);
  });

  test("when the server already holds an address, this browser is not offered a replacement", async () => {
    const f = fakeFetch({ get: () => ({ localPart: "lavega-abcdefghij" }) });
    const c = await render(f.impl);
    expect(
      [...c.querySelectorAll("button")].some((b) =>
        (b.textContent ?? "").includes("Maak mijn factuuradres"),
      ),
    ).toBe(false);
    byText("button", "Eigen adres gebruiken");
    expect(f.calls.filter((x) => x.method === "POST")).toHaveLength(0);
  });

  test("with an address set, a link leads to the guide in Facturen", async () => {
    setInvoiceForwardAddress("lavega-abcdefghij@invoices.lavega.dev");
    const go = vi.fn();
    // render with onNavigate: extend the local render() helper to accept it.
    await render(noneFetch().impl, go);
    click(byText("button", "Automatisch doorsturen instellen"));
    expect(go).toHaveBeenCalledWith("facturen");
  });
  ```

  Adapt the local helpers: `render(fetchImpl, onNavigate?)` passes `onNavigate`; add `clickAsync` if the file lacks it (copy from `facturen-n8n.test.tsx`). Then re-point the existing tests that used the suggestion button to seed the address directly: replace each `click(suggested)` flow (tests near lines 162-210, 285-345) with `setInvoiceForwardAddress("ale@invoices.lavega.dev")` before `render`, delete the two tests that exist only for the suggestion (`de lege staat biedt het leesbare adres…`, `op het leesbare adres klikken…`), and make the "intypen" tests (`hij kan het adres intypen…`, `een half overgetikt adres…`, `…eigen domein…`) click "Eigen adres gebruiken" first. The first existing test (`de opzethulp is weg…`) changes to click "Maak mijn factuuradres" with a POST-capable fake.

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @lavega/web exec vitest run src/koppelingen.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement settings**

  In `settings.ts` delete `SUGGESTED_INVOICE_FORWARD_ADDRESS` (and its doc comment). Add after `randomLocalSuffix`:

  ```ts
  /** A fresh, unguessable address that is NOT stored. The caller records it on the
   *  server first and persists it locally only after the server said yes, so a
   *  failed or colliding attempt leaves nothing behind. */
  export function generateInvoiceForwardAddress(
    makeSuffix: () => string = randomLocalSuffix,
  ): string {
    return `lavega-${makeSuffix()}@${INVOICE_FORWARD_DOMAIN}`;
  }
  ```

  and make `ensureInvoiceForwardAddress` use it (`const address = generateInvoiceForwardAddress(makeSuffix);`).

- [ ] **Step 4: Implement the copy** (`KoppelingenCopy` type, NL and EN together)

  Remove from the type and both objects: `suggestedButton`, `suggestedTradeoff`, `generateButton`, `generateTradeoff`. Add: `createButton`, `creating`, `createFailed`, `useOwnButton`, `setupLink`. New/changed values:

  | Key (`koppelingen.forwardAddress`) | NL                                                                                                                                                                                        | EN                                                                                                                                                                                 |
  | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `heading`                          | `Je persoonlijke factuuradres`                                                                                                                                                            | `Your personal invoice address`                                                                                                                                                    |
  | `eyebrow`                          | `Stuur of forward facturen naar dit adres; ze verschijnen bij Facturen onder Te bevestigen.`                                                                                              | `Send or forward invoices to this address; they appear under Invoices, waiting for your confirmation.`                                                                             |
  | `emptyIntro`                       | `Je hebt nog geen factuuradres.`                                                                                                                                                          | `You don't have an invoice address yet.`                                                                                                                                           |
  | `createButton`                     | `Maak mijn factuuradres`                                                                                                                                                                  | `Create my invoice address`                                                                                                                                                        |
  | `creating`                         | `Bezig met aanmaken…`                                                                                                                                                                     | `Creating…`                                                                                                                                                                        |
  | `createFailed`                     | `Aanmaken is mislukt. Er is niets opgeslagen; probeer het opnieuw.`                                                                                                                       | `Creating failed. Nothing was saved; please try again.`                                                                                                                            |
  | `useOwnButton`                     | `Eigen adres gebruiken`                                                                                                                                                                   | `Use my own address`                                                                                                                                                               |
  | `setupLink`                        | `Automatisch doorsturen instellen →`                                                                                                                                                      | `Set up auto-forwarding →`                                                                                                                                                         |
  | `server.none`                      | `Nog geen adres ingesteld — Facturen haalt nog niets automatisch op.`                                                                                                                     | `No address set yet — Facturen isn't fetching anything automatically.`                                                                                                             |
  | `server.confirmWarning(address)`   | `Dit maakt ${address} het adres waarmee Facturen je nieuwe facturen ophaalt. Een eerder ingesteld adres van jou wordt vervangen; een adres dat al bij een ander account hoort, kan niet.` | `This makes ${address} the address Facturen uses to fetch your new invoices. Any address you set before is replaced; an address that already belongs to another account can't be.` |

  `emptyIntro`'s old text ("Typ zelf een adres dat je in Cloudflare hebt aangemaakt") is gone on purpose. The existing `addressPlaceholder: "invoices@lavega.dev"` stays only inside the own-address input.

- [ ] **Step 5: Implement the view**

  In `Koppelingen.tsx`: drop the `SUGGESTED_…` import and `handleUseSuggestedAddress`; import `generateInvoiceForwardAddress`; add `type View` import and prop `onNavigate?: (view: View) => void`; state `showOwn` (init `false`), `creating`, `createNote`. Add:

  ```tsx
  async function handleCreateAddress() {
    setCreating(true);
    setCreateNote(null);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = generateInvoiceForwardAddress();
        const localPart = candidate.split("@")[0];
        const outcome = await recordForwardAddress(localPart, fetchImpl);
        if (outcome.kind === "taken") continue;
        if (outcome.kind !== "stored") {
          setCreateNote(c.forwardAddress.createFailed);
          return;
        }
        setInvoiceForwardAddress(candidate);
        const now = getInvoiceForwardAddress();
        setForwardAddress(now);
        setForwardDraft(now);
        setServerLocalPart(outcome.localPart);
        setServerState("ok");
        posthog.capture("invoice_forward_address_created");
        return;
      }
      setCreateNote(c.forwardAddress.createFailed);
    } finally {
      setCreating(false);
    }
  }
  ```

  Render rules: the typed `<input>` block shows when `forwardAddress || showOwn`; the empty-state block (`!forwardAddress && !forwardError`) shows `emptyIntro`, then **only if** `serverState === "ok" && !serverLocalPart` (or `serverState !== "ok"` is not enough: wait for the read) the primary `createButton` (disabled while `creating`; label `creating` while busy), and always the secondary `useOwnButton` (`onClick={() => setShowOwn(true)}`); render `createNote` below. When `forwardAddress` is set and `onNavigate` is given, render a `Button` with `c.forwardAddress.setupLink` calling `onNavigate("facturen")`. Keep the existing server-address block and `doRecord` flow untouched. In `App.tsx:1783` change to `<Koppelingen onNavigate={…} />` using the same navigation function `Facturen` receives at `App.tsx:1761` (read the lines to find its name).

  Because the create button must wait for the server read, the test `an empty state offers ONE create button` relies on `render()` awaiting the effect inside `act`; that is how the file already works.

- [ ] **Step 6: Run**

  ```bash
  pnpm --filter @lavega/web exec vitest run src/koppelingen.test.tsx src/copy
  pnpm --filter @lavega/web typecheck
  ```

  Expected: PASS (parity gates included: same keys in NL and EN, no internals).

- [ ] **Step 7: Stage**

  ```bash
  git add apps/web/src/settings.ts apps/web/src/views/Koppelingen.tsx apps/web/src/copy/admin.ts apps/web/src/koppelingen.test.tsx apps/web/src/App.tsx
  ```

---

### Task 9: Guide copy, with the Outlook claims checked against Microsoft

**Files:**

- Modify: `apps/web/src/copy/admin.ts` (`FacturenCopy` type, `nlFacturen`, `enFacturen`: new `guide` section)
- Test: `apps/web/src/copy/parity.test.ts` (already covers new keys), `forwardingGuide-ui.test.tsx` later

**Interfaces:**

- Produces `adminCopy[locale].facturen.guide` with exactly these members (the component in Task 10 consumes them):

  ```ts
  guide: {
    ariaLabel: string;
    heading: string;
    passedLine: (time: string) => string;
    showGuide: string;
    hideGuide: string;
    addressLabel: string;
    copyButton: string;
    copiedLabel: string;
    noAddress: string;
    goCreateAddress: string;
    tabsAriaLabel: string;
    tabGmail: string;
    tabOutlook: string;
    stepDoneAria: (n: number) => string;
    gmail: {
      step1: string; openSettings: string;
      step2Waiting: string; step2Code: (code: string) => string; step2Warn: string;
      step3: string; openFilters: string; copyQuery: string; queryCopied: string;
      step4: string;
    };
    outlook: {
      step1: string; openPersonal: string; openWork: string;
      step2: (words: string) => string;
      workNote: string;
    };
    otherApps: string;
    test: {
      heading: string; intro: string; subjectLabel: string;
      startButton: string; againButton: string; copySubject: string; subjectCopied: string;
      pending: string;
      passed: (time: string) => string;
      passedOtherCode: (time: string) => string;
      timedOut: string;
      checklist: string[];
    };
  }
  ```

- [ ] **Step 1: VERIFY the Outlook claims (research step, before the copy is final)**

  Use WebFetch (load it via ToolSearch `select:WebFetch` if deferred). Cheapest model, read-only. Fetch and read:
  1. `https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding`: does Microsoft 365 block automatic forwarding to external recipients **by default**? Record the exact wording and the date.
  2. Microsoft's Outlook-on-the-web rules article (search `learn.microsoft.com` / `support.microsoft.com` for "Manage email messages by using rules in Outlook on the web"): confirm there is a **Forward to** action, and whether it is available for Outlook.com (personal) accounts.
  3. Confirm the two deep links open the rules page: `https://outlook.live.com/mail/0/options/mail/rules` and `https://outlook.office.com/mail/options/mail/rules` (documentation only; do not open a browser).

  Decision table, then write the outcome into the plan's execution log (a comment in `forwardingGuide.ts` above the Outlook URLs):
  - Default-block **confirmed**: `workNote` may say "often blocks … by default".
  - **Unconfirmed or ambiguous** (the spec's fallback): `workNote` keeps the hedge "may block". The copy below is already written in this safe form; do not strengthen it without the quote.
  - A deep link not confirmed: replace that constant with `https://outlook.live.com/mail/` / `https://outlook.office.com/mail/` and have `step1` say "Settings, Mail, Rules" instead of promising the page. Keep the VERIFY comment.
  - If WebFetch is unavailable or the pages cannot be read: ship the hedged copy and the generic mail URLs, and say so in the final report.

- [ ] **Step 2: Add the copy** (NL and EN in the same edit; add the `guide` member to the `FacturenCopy` type with doc comments)

  NL (`nlFacturen.guide`):

  ```ts
  guide: {
    ariaLabel: "Automatisch doorsturen instellen",
    heading: "Automatisch doorsturen instellen",
    passedLine: (time) => `Automatisch doorsturen werkt — laatste test ${time}.`,
    showGuide: "Toon de handleiding",
    hideGuide: "Verberg de handleiding",
    addressLabel: "Jouw factuuradres",
    copyButton: "Kopieer",
    copiedLabel: "Gekopieerd",
    noAddress: "Je hebt nog geen factuuradres. Maak er eerst een aan.",
    goCreateAddress: "Maak je adres bij Koppelingen",
    tabsAriaLabel: "Kies je mailprogramma",
    tabGmail: "Gmail",
    tabOutlook: "Outlook",
    stepDoneAria: (n) => `Stap ${n} gedaan`,
    gmail: {
      step1: "Open de doorstuurinstellingen van Gmail, kies “Een doorstuuradres toevoegen” en plak je factuuradres hierboven.",
      openSettings: "Open Gmail-instellingen",
      step2Waiting: "Wachten op de code van Gmail… die komt meestal binnen een minuut.",
      step2Code: (code) => `Plak deze code in Gmail: ${code}`,
      step2Warn: "Zet “Een kopie van binnenkomende e-mail doorsturen” niet aan: dan gaat al je post naar LaVega.",
      step3: "Maak een filter met deze zoekopdracht.",
      openFilters: "Open Gmail-filters",
      copyQuery: "Kopieer zoekopdracht",
      queryCopied: "Gekopieerd",
      step4: "Vink bij de acties “Doorsturen naar” aan en kies je factuuradres.",
    },
    outlook: {
      step1: "Open de regels van Outlook.",
      openPersonal: "Regels van Outlook.com",
      openWork: "Regels van een werk- of schoolaccount",
      step2: (words) =>
        `Maak een nieuwe regel: voorwaarde “Heeft bijlage”, plus een onderwerp of tekst met een van deze woorden: ${words}. Actie: “Doorsturen naar” je factuuradres.`,
      workNote:
        "Werk- of schoolaccount? Organisaties met Microsoft 365 kunnen doorsturen naar adressen buiten de organisatie blokkeren. Komt de testmail niet aan, stuur facturen dan zelf door of vraag het je IT-beheerder.",
    },
    otherApps: "Een andere mailapp? Elke mailapp die automatisch kan doorsturen werkt: stuur je facturen door naar je factuuradres.",
    test: {
      heading: "Test het",
      intro: "Stuur jezelf een mail met een PDF als bijlage en dit onderwerp. Je eigen regel stuurt hem door, dus de hele keten wordt getest. Het onderwerp bevat al een woord dat je regel zoekt.",
      subjectLabel: "Onderwerp",
      startButton: "Start de test",
      againButton: "Nieuwe test",
      copySubject: "Kopieer onderwerp",
      subjectCopied: "Gekopieerd",
      pending: "Wachten tot de testmail aankomt… dit duurt hooguit 10 minuten.",
      passed: (time) => `Ontvangen om ${time} — automatisch doorsturen werkt.`,
      passedOtherCode: (time) => `Ontvangen om ${time} — automatisch doorsturen werkt. Het was wel een eerdere testmail.`,
      timedOut: "Nog niet aangekomen. Loop dit na:",
      checklist: [
        "Had de mail een PDF als bijlage, en past je filter of regel daarop?",
        "Heb je het adres in Gmail bevestigd met de code?",
        "Outlook met een werkaccount: kan je organisatie doorsturen blokkeren?",
        "Kijk in je spam en in je verzonden mail naar een foutmelding.",
      ],
    },
  },
  ```

  EN (`enFacturen.guide`), same keys:

  ```ts
  guide: {
    ariaLabel: "Set up auto-forwarding",
    heading: "Set up auto-forwarding",
    passedLine: (time) => `Auto-forwarding works — last test ${time}.`,
    showGuide: "Show the guide",
    hideGuide: "Hide the guide",
    addressLabel: "Your invoice address",
    copyButton: "Copy",
    copiedLabel: "Copied",
    noAddress: "You don't have an invoice address yet. Create one first.",
    goCreateAddress: "Create your address in Connections",
    tabsAriaLabel: "Choose your mail app",
    tabGmail: "Gmail",
    tabOutlook: "Outlook",
    stepDoneAria: (n) => `Step ${n} done`,
    gmail: {
      step1: "Open Gmail's forwarding settings, choose “Add a forwarding address” and paste your invoice address from above.",
      openSettings: "Open Gmail settings",
      step2Waiting: "Waiting for Gmail's code… it usually arrives within a minute.",
      step2Code: (code) => `Paste this code into Gmail: ${code}`,
      step2Warn: "Do not switch on “Forward a copy of incoming mail”: that sends all your mail to LaVega.",
      step3: "Create a filter with this search.",
      openFilters: "Open Gmail filters",
      copyQuery: "Copy search",
      queryCopied: "Copied",
      step4: "In the filter's actions, tick “Forward it to” and pick your invoice address.",
    },
    outlook: {
      step1: "Open Outlook's rules.",
      openPersonal: "Outlook.com rules",
      openWork: "Rules for a work or school account",
      step2: (words) =>
        `Create a new rule: condition “Has attachment”, plus a subject or body containing one of these words: ${words}. Action: “Forward to” your invoice address.`,
      workNote:
        "Work or school account? Microsoft 365 organisations may block forwarding to addresses outside the organisation. If the test mail never arrives, forward invoices by hand or ask your IT admin.",
    },
    otherApps: "Another mail app? Any app that can forward automatically works: forward your invoices to your invoice address.",
    test: {
      heading: "Test it",
      intro: "Send yourself a mail with a PDF attached and this subject. Your own rule forwards it, so the whole chain is tested. The subject already contains a word your rule looks for.",
      subjectLabel: "Subject",
      startButton: "Start the test",
      againButton: "New test",
      copySubject: "Copy subject",
      subjectCopied: "Copied",
      pending: "Waiting for the test mail to arrive… this takes 10 minutes at most.",
      passed: (time) => `Received at ${time} — auto-forwarding works.`,
      passedOtherCode: (time) => `Received at ${time} — auto-forwarding works. It was an earlier test mail, though.`,
      timedOut: "Not arrived yet. Check this:",
      checklist: [
        "Did the mail have a PDF attached, and does your filter or rule match it?",
        "Did you confirm the address in Gmail with the code?",
        "Outlook with a work account: your organisation may block forwarding.",
        "Check your spam folder and your sent mail for an error.",
      ],
    },
  },
  ```

  The words list is injected as `step2(RULE_WORDS)`; it is never in the copy tree. Check EN against the Dutch-substring list in `parity.test.ts` (none of the above contain `niet`, `geen`, `wordt`, `deze`, `jouw`, etc.).

- [ ] **Step 3: Run**

  ```bash
  pnpm --filter @lavega/web exec vitest run src/copy
  pnpm --filter @lavega/web typecheck
  ```

  Expected: PASS: same keys in both languages, English holds no Dutch, no internals, and the `guide` strings are scanned too (functions are probed).

- [ ] **Step 4: Stage**

  ```bash
  git add apps/web/src/copy/admin.ts apps/web/src/forwardingGuide.ts
  ```

---

### Task 10: The guide card and its integration in Facturen

**Files:**

- Create: `apps/web/src/views/ForwardingGuide.tsx`
- Create: `apps/web/src/forwardingGuide-ui.test.tsx`
- Modify: `apps/web/src/views/Facturen.tsx`
- Test: `apps/web/src/facturen-n8n.test.tsx` (integration cases)

**Interfaces:**

- Consumes: everything exported by `forwardingGuide.ts` (Task 6), `adminCopy[locale].facturen.guide` (Task 9), `N8nSetupSignal` / `outcome.setup` (Task 5).
- Produces: `default function ForwardingGuide(props: ForwardingGuideProps)` with

  ```ts
  type ForwardingGuideProps = {
    address: string; // "" when there is none
    state: GuideState;
    nowMs: number;
    onChange: (next: GuideState) => void;
    onStartTest: () => void; // Facturen creates the code and starts the clock
    onOpenKoppelingen: () => void;
  };
  ```

- [ ] **Step 1: Write the failing component tests**

  `apps/web/src/forwardingGuide-ui.test.tsx` (copy the jsdom / `createRoot` / `act` scaffold and `byText` / `click` helpers from `koppelingen.test.tsx`; render `<ForwardingGuide .../>` directly). Cover each state in **both** locales by looping `for (const lang of ["nl", "en"] as const)` with the cookie `lavega_locale=<lang>` and reading strings from `adminCopy[lang].facturen.guide` (never retyped):

  ```ts
  const base = () => ({ ...emptyGuideState() });
  // 1 no address: shows noAddress + goCreateAddress, no steps, clicking calls onOpenKoppelingen
  // 2 gmail, step 1 ticked, no code: shows gmail.step2Waiting
  // 3 gmail, confirmation {code:"123456789"}: shows step2Code("123456789") and the code text;
  //   and the page contains NO <a> whose href contains "mail-settings.google.com"
  // 4 test pending: shows test.pending and the subject testSubject(code, lang)
  // 5 passed: expanded=false line shows passedLine(<time>) and the showGuide button; after click, steps show
  // 6 passed-other-code: shows test.passedOtherCode(time)
  // 7 timed-out: shows test.timedOut and every checklist item
  // 8 outlook tab: shows outlook.step2(RULE_WORDS) containing "factuur, invoice", and workNote;
  //   both deep links are rendered with the constants' hrefs, target="_blank", rel="noopener noreferrer"
  // 9 the Gmail filter query is displayed (GMAIL_FILTER_QUERY) and the copy button writes it to the clipboard
  // 10 tab choice calls onChange with setTab(...); ticking a step calls onChange with toggleTick(...)
  ```

  Write real assertions for each (text via `container.textContent`, links via `querySelectorAll("a")`). Open/collapsed rule: the card is open when `state.passedAtMs === null`, collapsed to the one line when `passedAtMs !== null` (initial local `useState`), with a toggle button using `aria-expanded`.

  Integration tests appended to `facturen-n8n.test.tsx` (use its `serving()` / `Harness` / `fetchOnce`):

  ```ts
  test("setup signals update the guide and are NOT listed under Zelf ophalen", async () => {
    localStorage.setItem("lavega.invoiceForwardAddress", "lavega-abcdefghij@invoices.lavega.dev");
    const c = await fetchOnce(
      serving([
        {
          invoices: [],
          notices: [{ messageId: "g1", kind: "forwarding-confirmation", code: "424242" }],
        },
      ]),
    );
    expect(c.textContent).not.toContain(adminCopy.nl.facturen.notices.heading); // no "Zelf ophalen" block
    expect(JSON.parse(localStorage.getItem("lavega.forwardingGuide.v1")!).confirmation.code).toBe(
      "424242",
    );
    expect((await vault.getPendingNotices()).length).toBe(0);
  });

  test("a setup notice next to a real notice only lists the real one, and beforeunload is unaffected", async () => {
    const c = await fetchOnce(
      serving([
        {
          invoices: [],
          notices: [
            { messageId: "g1", kind: "setup-test", code: "k3x9" },
            { messageId: "n1", kind: "unreadable", reason: "x", mailUrl: "" },
          ],
        },
      ]),
    );
    // Exactly one row under "Zelf ophalen": the real notice. Use the row selector
    // the existing "Zelf ophalen" test in this file (~line 411) already uses.
    expect(c.textContent).toContain(adminCopy.nl.facturen.notices.heading);
    expect(c.textContent).not.toContain("k3x9");
    expect((await vault.getPendingNotices()).length).toBe(1);
  });

  test("while a test is pending Facturen fetches every 20 seconds and stops after 10 minutes", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("lavega.invoiceForwardAddress", "lavega-abcdefghij@invoices.lavega.dev");
      let queueCalls = 0;
      const impl = (async (input: RequestInfo | URL) => {
        if (urlOf(input).includes("/api/n8n/forward-address"))
          return { ok: true, status: 200, json: async () => ({ localPart: "lavega-abcdefghij" }) };
        queueCalls++;
        return { ok: true, status: 200, json: async () => ({ invoices: [], notices: [] }) };
      }) as unknown as typeof fetch;
      const c = render(impl);
      await act(async () => {});
      click(byText("button", adminCopy.nl.facturen.guide.test.startButton));
      const before = queueCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(queueCalls - before).toBe(3);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11 * 60_000);
      });
      const after = queueCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(queueCalls).toBe(after); // timed out: polling stopped
      expect(c.textContent).toContain(adminCopy.nl.facturen.guide.test.timedOut);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a result that lands after the window still turns the guide green", async () => {
    localStorage.setItem("lavega.invoiceForwardAddress", "lavega-abcdefghij@invoices.lavega.dev");
    const twentyMinutesAgo = Date.now() - 20 * 60 * 1000;
    localStorage.setItem(
      "lavega.forwardingGuide.v1",
      JSON.stringify({
        tab: "gmail",
        ticks: [],
        codeWaitStartedAtMs: null,
        confirmation: null,
        test: {
          code: "k3x9",
          startedAtMs: twentyMinutesAgo,
          receivedAtMs: null,
          receivedCode: null,
        },
        passedAtMs: null,
      }),
    );
    const c = await fetchOnce(
      serving([{ invoices: [], notices: [{ messageId: "t1", kind: "setup-test", code: "k3x9" }] }]),
    );
    const g = adminCopy.nl.facturen.guide;
    expect(c.textContent).not.toContain(g.test.timedOut);
    // collapsed to the one-line "works" state, because passedAtMs is now set
    expect(c.textContent).toContain(g.passedLine("").slice(0, 20));
  });
  ```

  (`passedLine("")` is `Automatisch doorsturen werkt — laatste test ` in NL; slicing 20 characters keeps the assertion independent of the clock.)

- [ ] **Step 2: Run to verify they fail**

  Run: `pnpm --filter @lavega/web exec vitest run src/forwardingGuide-ui.test.tsx src/facturen-n8n.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement the component**

  `apps/web/src/views/ForwardingGuide.tsx`: one function component, props as above, `const [locale] = useAppLocale(); const c = adminCopy[locale].facturen.guide;`.

  Structure (keep markup plain, reuse existing classes `cell-sub`, `flex flex-wrap gap-2`, `Button`):
  - Header row: heading, toggle `Button` (`aria-expanded`, label `hideGuide`/`showGuide`). Initial `open = state.passedAtMs === null`. When collapsed and `passedAtMs !== null`, render only `c.passedLine(fmt(state.passedAtMs))` and the toggle.
  - `fmt = (ms) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(ms)`.
  - Address row: `<code>{address}</code>` + copy `Button` (`navigator.clipboard.writeText`, 1.5 s "Gekopieerd", try/catch like `Koppelingen.tsx` `handleCopyAddress`). If `address === ""`: render `c.noAddress` and a `Button` `c.goCreateAddress` calling `onOpenKoppelingen`; render nothing else (no steps).
  - Tabs: two `Button`s in a `role="tablist"` with `aria-label={c.tabsAriaLabel}`; click calls `onChange(setTab(state, tab))`.
  - Each step: a checkbox (`aria-label={c.stepDoneAria(n)}`, `checked={state.ticks.includes(id)}`, `onChange` calls `onChange(toggleTick(state, id, nowMs))`) next to its text. Ids: `gmail:1..4`, `outlook:1..2`.
  - Gmail step 2 body: if `state.confirmation` show `<strong>{c.gmail.step2Code(code)}</strong>` else `c.gmail.step2Waiting`; always `c.gmail.step2Warn`. **No anchor or text from the mail other than the digits.**
  - Links: `<a href={URL} target="_blank" rel="noopener noreferrer">` for `GMAIL_FORWARDING_URL`, `GMAIL_FILTERS_URL`, `OUTLOOK_COM_RULES_URL`, `OUTLOOK_WORK_RULES_URL`.
  - Gmail step 3 shows `GMAIL_FILTER_QUERY` in a `<code>` with a copy button (`copyQuery` / `queryCopied`).
  - Outlook: `c.outlook.step2(RULE_WORDS)` and `c.outlook.workNote` as a visible note (`role="note"`).
  - `c.otherApps` as a one-line note under the tabs.
  - Test section: `status = testStatus(state, nowMs)`. `none` or `timed-out` or any passed: show `startButton`/`againButton` calling `onStartTest`. When `state.test` exists show the subject `testSubject(state.test.code, locale)` with `copySubject`. `pending` shows `c.test.pending`; `passed` / `passed-other-code` show the matching line with `fmt(state.test.receivedAtMs!)`; `timed-out` shows `timedOut` and the `checklist` as a `<ul>`.

- [ ] **Step 4: Integrate into Facturen**

  In `Facturen.tsx`:
  1. Imports: `ForwardingGuide`, the guide helpers (`loadGuideState`, `saveGuideState`, `applySignals`, `startTest`, `newTestCode`, `readNowMs`, `isPollingActive`, `TEST_POLL_MS`, `type GuideState`), and `getInvoiceForwardAddress` from `../settings`.
  2. State, next to the other hooks:

     ```tsx
     const [guide, setGuide] = useState<GuideState>(() => loadGuideState());
     const guideRef = useRef(guide);
     const [clockMs, setClockMs] = useState(() => readNowMs());
     function commitGuide(next: GuideState) {
       guideRef.current = next;
       setGuide(next);
       saveGuideState(next);
     }
     ```

  3. In `runFetchN8n`, right after the `outcome.kind` guards and before `const handled = …`:

     ```tsx
     if (outcome.setup.length > 0) {
       const at = readNowMs();
       commitGuide(applySignals(guideRef.current, outcome.setup, at));
       setClockMs(at);
     }
     ```

     Setup signals never enter `freshNotices`, `nextNotices`, the vault, `beforeunload` or the `dropped` count (they are a separate list from `parseQueue`).

  4. The polling effect, after the existing interval effect:

     ```tsx
     const polling = isPollingActive(guide, clockMs);
     useEffect(() => {
       if (!storage || !polling) return;
       const id = setInterval(() => {
         setClockMs(readNowMs());
         void fetchLatest.current();
       }, TEST_POLL_MS);
       return () => clearInterval(id);
     }, [storage, polling]);
     ```

     It reuses `fetchLatest` and so the existing single-flight `inFlight` guard: a poll that overlaps another fetch returns the same promise and never starts a second request. (The queue is emptied by each response; two overlapping requests would split it.)

  5. Render the card as the first child of the `1 · Automatisch` `Module` (above `pullIntro`):

     ```tsx
     <ForwardingGuide
       address={getInvoiceForwardAddress()}
       state={guide}
       nowMs={clockMs}
       onChange={commitGuide}
       onStartTest={() => {
         const at = readNowMs();
         setClockMs(at);
         commitGuide(startTest(guideRef.current, newTestCode(), at));
       }}
       onOpenKoppelingen={() => onNavigate("koppelingen")}
     />
     ```

- [ ] **Step 5: Run**

  ```bash
  pnpm --filter @lavega/web test
  pnpm --filter @lavega/web typecheck
  pnpm run lint
  ```

  Expected: PASS. Known accepted rough edge (list under "Consider"): while polling, the status line under the fetch button flickers "Bezig met ophalen…" every 20 s.

- [ ] **Step 6: Stage**

  ```bash
  git add apps/web/src/views/ForwardingGuide.tsx apps/web/src/forwardingGuide-ui.test.tsx apps/web/src/views/Facturen.tsx apps/web/src/facturen-n8n.test.tsx
  ```

---

### Task 11: Docs in step with the code

**Files:**

- Modify: `docs/n8n/DOORSTUURADRES.md` (paragraph at ~124-130 about the Gmail verification code landing in n8n)
- Modify: `docs/n8n/FACTUREN.md` (the table of notice kinds at ~190-199, and the re-import checklist)

- [ ] **Step 1: Edit DOORSTUURADRES.md**

  Replace the paragraph that ends "Zoek hem op in n8n → Executions → de body van "E-mail binnen"." with:

  > Gmail wil dat adres eerst als doorstuuradres bevestigd hebben: het stuurt er een verificatiecode naartoe. Sinds de handleiding in _Facturen → 1 · Automatisch_ herkent de workflow die mail (afzender `forwarding-noreply@google.com`, een cijfercode) zonder het model, en LaVega toont **alleen de code** in de handleiding. Er is geen link uit de mail te openen. Komt de code niet binnen, dan staat hij nog steeds in n8n → Executions → de body van "E-mail binnen". **De exacte vorm van Googles mail is vastgelegd in `packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.json`; verandert Google de tekst, dan faalt `setupMail.test.ts` en niet de productie.**

- [ ] **Step 2: Edit FACTUREN.md**

  Add to the notice-kinds section a note after the four-kind table: two more kinds exist on the wire, `forwarding-confirmation` and `setup-test`; they carry only `code`, are never shown under "Zelf ophalen", and are consumed by the forwarding guide. Add to the "Wat je na Import from File moet nalopen" list: after re-importing, send a test mail with subject `LaVega test abcd factuur` to the forwarding address and check that the run ends in "Melding: zelf ophalen" and that "Bouw Claude-verzoek" did not run.

- [ ] **Step 3: Format check and stage**

  ```bash
  pnpm exec oxfmt --check docs/n8n/DOORSTUURADRES.md docs/n8n/FACTUREN.md
  git add docs/n8n/DOORSTUURADRES.md docs/n8n/FACTUREN.md
  ```

---

### Task 12: Release (web first, then the n8n workflow)

No code. Exact order; the owner commits and deploys. An agent verifies each gate and stops at the first failure.

- [ ] **Step 1: Gate, nothing ships on the synthetic fixture**

  ```bash
  ls packages/core/src/n8n/__fixtures__/gmail-forwarding-confirmation.json
  ```

  Expected: the file exists (the real capture from Task 1). If it does not: **stop**. The classifier's shape is unverified. Then re-run `pnpm --filter @lavega/core exec vitest run src/n8n/setupMail.test.ts` and confirm the log line reads `fixture is REAL`; if the real mail's wording differs from the assumed one, fix `confirmationCodeOf` until the real fixture passes (the tests already read it).

- [ ] **Step 1b: Real-fixture gate (after the real Gmail capture is added)**

  ```bash
  REQUIRE_REAL_GMAIL_FIXTURE=1 pnpm --filter @lavega/core test
  ```

  The release is **blocked until this passes**. Without the variable the real-fixture check is skipped, so a green ordinary run proves nothing about it.

- [ ] **Step 2: Full local gates**

  ```bash
  pnpm run sync:n8n -- --check
  pnpm --filter @lavega/core test && pnpm --filter @lavega/core typecheck
  pnpm --filter @lavega/email-worker test && pnpm --filter @lavega/email-worker typecheck
  pnpm --filter @lavega/web test && pnpm --filter @lavega/web typecheck
  pnpm run lint
  pnpm run format
  ```

  Expected: all green. Report separately anything not run.

- [ ] **Step 3: Independent review before it reaches the owner**

  A different agent reviews the staged diff (per the owner's workflow: `/code-review`, or a `sonnet` subagent with the pstack interrogate rubric). Fix everything in "Act on"; list "Consider" in the hand-off.

- [ ] **Step 4: Deploy the web build FIRST (owner)**

  Owner commits, merges to `master`, and Vercel deploys `https://www.lavega.dev`. Why first: today's web build silently discards unknown notice kinds and a fetch empties the n8n queue, so if the workflow went first, the first confirmation code would be fetched and thrown away by the old build. After the new web build is live, the owner opens Facturen and sees the guide; no setup notice can exist yet because the workflow is unchanged.

- [ ] **Step 5: Update the workflow on the operator's n8n SECOND (owner, by hand)**

  Re-provisioning will **not** do this. `provisionN8n` on an existing workflow rewrites only the webhook node ("the rest of the nodes are the ones already in his n8n, deliberately", `apps/web/src/n8n-provision.ts:339-343`). Two ways, recommended first:
  1. **Paste the three changed Code nodes (recommended: keeps credentials).** From `docs/n8n/lavega-facturen-workflow.json` copy the `parameters.jsCode` of "Normaliseer binnengekomen mail", "Melding: zelf ophalen" and "Naar LaVega-vorm" into the same three nodes of the live workflow. Save and keep it active.
  2. **Re-import** `docs/n8n/lavega-facturen-workflow.json` per `docs/n8n/FACTUREN.md` "Wat je na Import from File moet nalopen": re-attach the Gmail credential and the Header Auth credential `LaVega factuurtoken`, confirm the production webhook URLs and paths are unchanged, activate.

  Rollback: re-paste the previous `jsCode` from `git show master:docs/n8n/lavega-facturen-workflow.json` (before the merge) or from n8n's workflow history. The web build is safe to leave deployed, because with the old workflow the new guide just waits and the test times out with its checklist.

- [ ] **Step 6: End-to-end, once, by hand (owner; evidence = screenshots)**

  With a real Gmail account and the production address: (a) in the guide tick Gmail step 1, add the address in Gmail, see the code appear in LaVega within about a minute, paste it into Gmail; (b) create the filter with the shown search, forward to the address; (c) start the test, send the PDF mail with the shown subject to yourself, see "Received at HH:MM" within 10 minutes; (d) confirm nothing was listed under "Zelf ophalen" and no Claude call appears in n8n's run for these two mails. Open points to look at while doing it, because they are assumptions: whether Gmail's filter-forward keeps the subject (the classifier tolerates `Fwd:`), whether self-sent mail triggers the filter, and whether the confirmation subject carries the code. Save screenshots under the owner's evidence folder and note the path in the commit message.

- [ ] **Step 7: Stage**

  Nothing new. `git status` should show only the staged files from Tasks 1 to 11.

---

## Self-review

**1. Spec coverage**

- Section 1 (guide in Facturen, Koppelingen link): Task 10, Task 8 (`setupLink`).
- Section 2 (card, tabs, steps, ticks, Outlook note, VERIFY): Tasks 6, 9, 10. VERIFY check is Task 9 Step 1.
- Section 3 (classifier, no model, code only): Tasks 1 to 3; "no link" pinned in Task 2 and Task 10 test 3.
- Section 4 (test it, 20 s / 10 min, outcomes, wrong code): Tasks 6 and 10.
- Section 5 (data shape, deploy order): Task 5 (deviation noted), Task 12.
- Section 6.1 to 6.3: Task 7. Section 6.4: Task 8.
- Section 8 testing: core (Task 2, 3), worker contract (Task 4), web (Tasks 5, 6, 8, 10). The "end to end once" is Task 12 Step 6.
- Gmail fixture requirement: Task 1 (manual capture, SYNTHETIC fixture, loader), Task 12 gate.

**2. Placeholder scan.** One spot intentionally defers to the file as it stands: Task 8 Step 5 (name of the navigation function passed to `Facturen` at `App.tsx:1761`); it says exactly where to read it. The Schema spelling fallback in Task 5 names the file to consult.

**3. Type consistency.** `SetupSignal` (core, `kind` + `code`), `N8nSetupSignal` (web, same two fields), `GuideState` fields (`tab`, `ticks`, `codeWaitStartedAtMs`, `confirmation`, `test`, `passedAtMs`) and function names (`applySignals`, `startTest`, `toggleTick`, `setTab`, `testStatus`, `isPollingActive`, `readNowMs`, `newTestCode`, `testSubject`) are used identically in Tasks 6, 9, 10. Copy member `test.copySubject` is consistent between the interface block and the component. `noticeForSetup` appears in Tasks 3 only, and is exported from `claudeToLaVega.js`. `RULE_WORDS` is passed to `outlook.step2(words)`.

**4. Review Focus.** Item 1 to Task 3 tests (empty Message-ID), item 2 to Tasks 6 and 10 (late result), item 3 to Task 8 (server already holds an address), item 4 to Task 6 (blocked or garbage localStorage), item 5 to Tasks 2, 3, 6 (resend / two codes).
