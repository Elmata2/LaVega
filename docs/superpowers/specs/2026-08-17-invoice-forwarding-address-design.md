# Invoices by forwarding address — design

**The user experience Alexander asked for**: accept the terms, link it, invoices appear in LaVega.
**Without** the thing that makes the obvious route expensive: `gmail.readonly` is a Google
_restricted_ scope, so a public app needs OAuth verification plus a **CASA Tier 2 assessment,
redone every 12 months**, from about $3,000 upward. That is a bill before the first customer, and
it buys access to the user's entire mailbox — far more than we need and more than a careful user
wants to give.

So: each user gets an address, forwards invoices to it, and everything downstream is what we
already built and tested.

```
factuur@leverancier.nl
      │  (user forwards, or a Gmail filter forwards automatically)
      ▼
alexander-7f3a@invoices.lavega.dev
      │  Cloudflare Email Routing → Email Worker
      ▼
n8n webhook  ──►  the EXISTING pipeline: PDF → Claude → queue
      ▼
LaVega pulls the queue, he confirms each row
```

## Why this shape and not another

**Cloudflare, because the domain is already there.** `dig NS lavega.dev` returns
`wells.ns.cloudflare.com` / `lara.ns.cloudflare.com`, and there are **no MX records** — nothing to
displace. Cloudflare Email Routing is free, and an Email Worker runs code on the incoming message
rather than merely forwarding it. No inbound-email vendor, no new bill, no new host.

**n8n stays the processor, so the LaVega server still never sees an invoice.** The Email Worker
POSTs to the same webhook the Gmail branch already feeds. Everything after that point — the PDF
handling, the Claude call, the confirm-first queue, the dedup, the "unreadable attachment is
reported not dropped" rule — is code that has already been debugged the hard way. Reusing it is the
main argument for this design.

**A user grants strictly less than with OAuth.** They forward what they choose. There is no standing
token, no mailbox-wide read, nothing to revoke in a panic, and nothing for us to lose. That is a
better privacy story than the incumbents' OAuth flows — and privacy is LaVega's actual
differentiator, so it should be the loud part of the copy, not the apologetic part.

## The address

    <slug>-<random>@invoices.lavega.dev        e.g. alexander-7f3a@invoices.lavega.dev

- The random suffix is the security boundary: an address nobody can guess cannot be spammed by
  anybody who has not been told it. Not a secret worth defending on its own — see below — but enough
  that the queue is not a public letterbox.
- A catch-all route means a new user costs no configuration. The local part identifies the queue.
- Single-user today (his own address), multi-user later without a redesign.

## What the Email Worker does

1. Reject anything over the size cap before parsing. The PDF limit is already 4 MB per attachment,
   three per message.
2. Parse the MIME message: subject, from, date, text/plain preferring text/html, and the PDF
   attachments as base64.
3. POST to the n8n webhook with a shared secret header, plus the local part of the recipient so the
   queue knows whose it is.
4. On any failure, **bounce or reply** rather than silently swallow. A forwarded invoice that
   vanishes without trace is the worst outcome available here: the user believes it arrived.

## What changes in the n8n workflow

Almost nothing, which is the point.

- A second webhook node, "E-mail binnen", authenticated with the shared secret.
- `normalizeGmailMessage` gains a sibling — or, better, its input adapter does. The tested core is
  already shape-agnostic once it has `{subject, from, date, text, attachments[]}`; only the mapping
  from the incoming envelope differs. Extend the tested module in `packages/core/src/n8n/` and
  regenerate through `pnpm run sync:n8n`, so the drift test keeps both honest.
- The queue entry records **which address it arrived at** and **who sent it**, both shown in the
  review row. Provenance is what lets him judge a row he did not expect.

## The threats, and what actually answers them

- **Anyone who learns the address can post invoices into the queue.** Answered by the design that
  already exists: nothing books itself, every row is confirmed by hand, and a row without an amount
  is refused outright. A spammer wastes his attention, not his books. The queue cap (200, oldest
  dropped) bounds the damage.
- **Spoofed senders.** Show the sender in the review row and do not pretend it is verified. If this
  becomes real, check SPF/DKIM results in the Worker — Cloudflare exposes them — and mark rows that
  fail rather than dropping them.
- **A forwarded invoice contains someone else's data.** Same rule as everywhere: only the model and
  n8n see it, the LaVega server does not.

## What this does NOT do

Say it plainly in the UI rather than letting people discover it:

- It does not read a mailbox. Only what is forwarded arrives.
- It does not find invoices retroactively. A Gmail filter can be set to catch new mail; old invoices
  must be forwarded by hand.
- It needs one setup step from the user — a forwarding filter — which is a click or two more than
  OAuth and a great deal less than a security assessment.

## v2 — OAuth "Connect Gmail", and what it costs

Recorded so the trade is not re-litigated from memory:

- `gmail.readonly` is a **restricted** scope: OAuth verification **plus CASA Tier 2**, renewed
  annually, from roughly $3,000 and historically far more.
- Background sync requires a **server-held refresh token** with standing access to the whole
  mailbox — the browser is closed when the job runs. That ends local-first for this feature and
  needs a recorded decision against `CONTEXT.md` constraint 2.
- Partial mitigation, not a cure: the worker can encrypt each extracted invoice to the user's public
  key so the server stores only ciphertext. Plaintext still exists in server memory during
  extraction, and the token remains a standing key to the mailbox.
- n8n would change from one workflow to one workflow over many users — an HTTP Request node with
  each user's token, since the Gmail node binds to a single credential.
- **Outlook may be the cheaper first OAuth**: Microsoft requires publisher verification but, as far
  as I know, no paid annual assessment. Verify that properly before planning around it.

Nothing built for the forwarding route is wasted if OAuth arrives later: extraction, queue,
confirm-first review and dedup all sit downstream of how the mail arrived.
