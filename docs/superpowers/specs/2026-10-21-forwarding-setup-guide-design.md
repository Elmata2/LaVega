# Forwarding setup guide — design

**What Alexander asked for** (21 Oct 2026): make the forwarding address feel like "connecting"
Gmail or Outlook — an in-app, step-by-step guide to an auto-forward rule, plus a "test it" button.
No OAuth. Background: `docs/BACKLOG.md` §7.2 (why forwarding, not OAuth) and
`docs/superpowers/specs/2026-08-17-invoice-forwarding-address-design.md` (the address itself).

**Who it is for**: a tester from a founder community. Not technical, Dutch or English, has never
heard of n8n and never should.

**Done means**: a tester with a Gmail or Outlook.com account goes from "no address" to "a test mail
arrived" without leaving LaVega except to click through their own mail settings, and without anyone
looking in n8n.

## The blocker this design exists to remove

Gmail only forwards to an address it has confirmed, and it confirms by mailing a code **to that
address** (`docs/n8n/DOORSTUURADRES.md`, "Gmail wil dat adres eerst als doorstuuradres
bevestigd hebben"). Today that mail lands in n8n's execution log. For anyone but the operator the
Gmail route dead-ends at step 2. The guide is worthless without fixing this, so it is in scope.

## 1 · Where the guide lives

In **Facturen → "1 · Automatisch"**, not in Koppelingen.

Reason: the queue fetch lives in Facturen (`apps/web/src/views/Facturen.tsx`, the pull on open and
the interval at ~line 375), and fetching **empties the n8n queue**. Fetched rows are saved to the
vault (`App.tsx:585-599`), so nothing is lost, but a second fetcher would race the first and split
the merge logic. One fetcher, one place.

The Koppelingen forward-address card keeps owning the address (create / copy / record on the
server) and gains one link: "Set up auto-forwarding →" to the guide.

## 2 · The guide

A collapsible card at the top of "1 · Automatisch", open by default until the test has passed once,
then collapsed to one line ("Auto-forwarding works — last test 14:02. Show guide").

Shows the user's address with the existing copy button. If there is no address yet, step 0 is
"create your address" and links to the Koppelingen card. Two tabs, **Gmail** and **Outlook**,
remembered per device in localStorage (try/catch, works without it).

**Gmail**

1. Open forwarding settings (deep link `https://mail.google.com/mail/u/0/#settings/fwdandpop`),
   "Add a forwarding address", paste the address.
2. Enter the confirmation code. LaVega shows it here as soon as it arrives (§3). Until then:
   "Waiting for Gmail's code… it usually arrives within a minute." The code wait starts when
   the Gmail tab is shown or the step-1 settings link is clicked, so a code that arrives before
   step 2 is not discarded as stale. Do **not** switch on
   "Forward a copy of incoming mail" — that forwards everything.
3. Create a filter (deep link `#settings/filters`) with the search we give, with a copy button:
   `has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)`.
4. In the filter's actions, tick "Forward it to" and pick the address.

**Outlook**

1. Open rules (Outlook.com: `https://outlook.live.com/mail/0/options/mail/rules`; work account:
   `https://outlook.office.com/mail/options/mail/rules`).
2. New rule: condition "Has attachment" plus subject or body includes one of the same words;
   action "Forward to" the address.
3. A visible note for work accounts: Microsoft 365 organisations often block forwarding to
   outside addresses by default. If the test never arrives, forward invoices by hand or ask your
   IT admin. **The default-block claim and both deep links must be checked against Microsoft's
   current documentation before this copy ships**; if unconfirmed, the note says "may block".

Each step has a checkbox the user ticks themselves, stored locally. Ticks are a memory aid, not
state the app relies on. The only proven state is a passed test.

## 3 · Gmail's confirmation code, shown in LaVega

**Recognise it before the model sees it.** In `packages/core/src/n8n/normalizeInboundMail.js`,
add a pure classifier that marks a message as a Gmail forwarding confirmation when **all** hold:
the From address is `forwarding-noreply@google.com`, and a confirmation code (digits only) can be
extracted from subject or body. The exact subject/body shape is taken from **a real confirmation
mail captured as a fixture** in `packages/core/src/n8n/__fixtures__/`, not from memory. Both the
English and the Dutch Gmail variant if Gmail localises it; checked during implementation.

**Route it without Claude.** The workflow gets a branch: a recognised confirmation becomes a
queue notice of a new kind, `forwarding-confirmation`, carrying `code` (digits only, max 20) and
nothing else from the body. No model call, no cost.

**What Google sends is unverified.** Google's help pages document only a confirmation _link_. The
guide shows a code only if the real mail contains one. If it does not, the guide says to click the
link in the mail Gmail sent to the LaVega address, and offers manual forwarding (which needs no
confirmation) as the fallback. The real capture at release decides which path ships.

**Show only the code, never a link.** Since #260 the worker cannot verify senders, so anyone can
send a mail that looks like Google's. Showing its link inside LaVega would lend a phishing link
our trust. A digits-only code is harmless: a fake one is simply rejected by Gmail. The guide says
"Paste this code into Gmail" and links to Gmail's own settings page, never to anything from the
mail.

## 4 · "Test it"

1. The button shows a subject to use, `LaVega test <4 random chars> factuur` (EN: `invoice`; the
   classifier accepts both word orders, and the filter word makes
   both the Gmail filter and the Outlook rule match), with a copy button, and
   asks the user to send a mail **to themselves** with a PDF attached and that subject. Their own
   rule then forwards it, so the whole chain is tested: their rule, Cloudflare, the worker, n8n,
   LaVega. (A PDF is needed because the Gmail filter requires one. For Outlook the subject word
   "test" is not one of the filter words, so the guide tells Outlook users to put "factuur" in
   the subject too.) Copy explains this in one sentence; no PDF is read.
2. The classifier from §3 also recognises `LaVega test <code>` in the subject and routes it to a
   notice of kind `setup-test` carrying the code. No model call. Attachments are not passed on.
3. Facturen's existing fetch consumes `setup-test` and `forwarding-confirmation` notices: they
   update the guide and are **not** listed under "Zelf ophalen". While a test is pending the guide
   fetches every 20 seconds for up to 10 minutes (the interval only runs while Facturen is open).
4. Outcomes: "Received at 14:02 — auto-forwarding works." Or, after 10 minutes, "Not arrived yet"
   with the checklist: is the filter's search matching (did it have a PDF?), is the address
   confirmed in Gmail, Outlook work account blocked, check spam/bounces. A received test with the
   wrong code (an older test) counts as received but says so.

## 5 · Data shape changes

- `QueueNotice.kind` (core) gains `forwarding-confirmation` and `setup-test`. The web parser keeps
  them in their own `setup` list (`apps/web/src/n8n.ts`), not in `N8nNotice` / `NOTICE_KINDS`, so
  they never show under "Zelf ophalen". Each carries a `code` parsed digits-only (confirmation) or
  `[a-z0-9]{4}` (test). A malformed code is counted in `setupDropped`, not skipped silently and not
  mixed into `dropped`.
- **Deploy order matters**: today's web build skips unknown notice kinds (`n8n.ts:154`), and the
  fetch empties the queue. Ship the web build first, then update the n8n workflow. The bundled copy
  is `docs/n8n/lavega-invoices.json` (+ `lavega-facturen-workflow.json`); `provisionN8n` only
  rewrites the webhook node on an existing workflow (`n8n-provision.ts:339`), so the changed code
  nodes reach the operator's n8n by pasting them or re-importing, not by re-provisioning.

## 6 · Untrue and internal copy on the same screens (UX audit, 21 Oct, items 1–4)

The guide sends testers into Facturen and Koppelingen, so what they meet there must be true and
free of internals. All copy changes land in `apps/web/src/copy/admin.ts`, NL and EN together.

1. **Sender line.** `senderUnchecked` (NL ~817, EN ~1393) says no sender check ran because the mail
   "did not arrive through the forwarding address". Since #260 every row arrives through it with
   checks `unknown` (`n8n.ts` `autoBookDecision` holds all as `sender-unchecked`). New text:
   NL "LaVega kan bij deze mail niet nagaan wie de afzender is, dus hij wacht op jou. Controleer
   hem en bevestig." / EN "LaVega can't verify who sent this mail, so it waits for you. Check it
   and confirm."
2. **Auto-booking promises.** The head eyebrow, `gateNote` (~661), and the `autoBooked` badge /
   undo copy (~762, ~893) and EN twins promise self-booking that cannot happen. Rewrite to: NL
   "Elke factuur wacht op jouw bevestiging — LaVega boekt niets zelf." / EN "Every invoice waits
   for your confirmation — LaVega books nothing by itself." Drop the SPF/DKIM sentences. The
   `autoBookDecision` code path stays (it becomes reachable again if a trusted verdict ever
   exists); only the copy stops promising it.
3. **No n8n in user copy.** Button "Ophalen uit n8n" → NL "Nieuwe facturen ophalen" / EN "Check
   for new invoices"; intro → "LaVega kijkt of er facturen zijn binnengekomen zodra je dit scherm
   opent, en daarna elke {minutes} minuten." / "LaVega checks for new invoices when you open this
   screen, then every {minutes} minutes."; eyebrow "uit n8n · N" → "uit je mailbox · N" / "from
   your inbox · N"; HTTP/workflow errors → "Ophalen lukt nu niet. Er is niets verloren; probeer
   het straks opnieuw." / "Couldn't fetch right now. Nothing was lost — try again shortly.";
   aria labels end in " (te bevestigen)" / " (to confirm)" instead of " (n8n)", matching the manual form labels; "wachtrij"/"queue" → "Te bevestigen" / "To confirm". Rule for the
   test: no user-visible string in `copy/admin.ts` facturen/koppelingen contains `n8n`, `webhook`,
   `messageId` or `workflow`.
   **The warning at ~809 is untrue too:** it says reload or lock wipes fetched rows, but they are
   saved to the vault (`App.tsx:585-599`). Keep only what is true: once fetched they exist only in
   LaVega, not in the mailbox pipeline, so confirm or reject them here.
4. **Koppelingen dead end.** Remove "Typ zelf een adres dat je in Cloudflare hebt aangemaakt" and
   the `SUGGESTED_INVOICE_FORWARD_ADDRESS` (`ale@…`, `settings.ts:268`) offer — it hands the
   owner's personal alias to every tester and collides on the server (409). The only action for a
   user without an address is one button, NL "Maak mijn factuuradres" / EN "Create my invoice
   address", which generates the random address **and** records it on the server in one step.
   Typing a custom address stays possible behind "Eigen adres gebruiken" / "Use my own address"
   for the operator. Heading NL "Je persoonlijke factuuradres" / EN "Your personal invoice
   address"; plus "Stuur of forward facturen naar dit adres; ze verschijnen bij Facturen onder Te
   bevestigen." / "Send or forward invoices to this address; they appear under Invoices, waiting
   for your confirmation."

## 7 · Out of scope

OAuth for either provider; importing invoices that arrived before the rule existed; any provider
beyond Gmail and Outlook (Apple Mail and others get a one-line "any mail app that can forward"
note); auto-booking.

## 8 · Testing

- Core: classifier unit tests on the captured fixture(s), a spoofed lookalike (wrong sender), a
  code with letters (rejected), a test-subject mail, and an ordinary invoice that mentions "test"
  in its body (must still go to the model). `pipeline.test.ts`: both new kinds reach the queue
  with no Claude request built.
- Worker contract test (`apps/email-worker/test/contract.test.ts`): a raw Gmail confirmation goes
  through the worker and `normalizeInboundMail` intact.
- Web: `n8n.ts` parses the two kinds and drops malformed codes; Facturen consumes them without
  listing them under "Zelf ophalen"; the guide's states (no address, waiting for code, code shown,
  test pending, passed, timed out) each render in NL and EN.
- End to end, once, by hand: a real Gmail account through the production address, code shown in
  LaVega, filter created, test passed. Evidence: screenshots.
