# Instinct privacy gap check (verified)

| | |
|---|---|
| **What this is** | A check of the Instinct privacy text and consent wording against the code. Not legal advice. Not a legal sign-off. |
| **Blocker** | GitHub issue #348 stays open until a lawyer answers the "Ask a lawyer" list. |
| **Reviewed at** | `master`, commit `955972d17`, 18 Nov 2026. Line numbers move; re-check them after edits. |
| **Supersedes** | The 18 Nov 2026 comment by the cofounder. Where that comment was wrong or stale, this document says so in section 2. |
| **Legend** | **V** = verified in code at `file:line`. **NV** = not verifiable from this repository. **Mismatch** = the text promises something the code does not do. |

## 1. Bottom line

The Instinct section of the privacy text is unusually accurate for a first draft. Most sentences match the code. The problems are concentrated in four places:

1. **The consent sentence is much narrower than the processing.** It does not mention the browser mirror, merchant names and amounts in e-mail and push, the recipients (Resend, the browser push service, Meta), or that the bank read happens unattended. One checkbox covers all of it.
2. **Account numbers are not memory-only.** The Enable Banking session row stores the raw account list the bank returned (`apps/server/src/eb-routes.ts:20-27, 293`), sealed, with a TTL of 181 days (`eb-routes.ts:68`). The adapter expects `account_id.iban` in that shape (`packages/adapters/src/banking/enableBankingMap.ts:43, 183`). Whether production responses actually carry IBANs is NV, but the code is built for it.
3. **The personal-data reset leaves all Instinct data in place.** `PERSONAL_RESET_TABLES` (`packages/database/src/index.ts:1683-1689`) deletes the bank session but none of the seven `agent_*` tables. The user ends up with Instinct still enabled, no bank link, and all history, mirror, push subscription and phone number retained.
4. **Article 13 gaps.** No legal entity, address or Chamber of Commerce number; a Gmail address as privacy contact; Resend and the push services missing from the transfer section; no statement on whether providing data is required; no statement on profiling; no retention period for settings, mirror, push subscription or phone number.

The full erase path is correct: "Servergegevens verwijderen" calls `/api/account/data` and `eraseUserData`, which deletes all seven agent tables (`packages/database/src/index.ts:1556-1563`). The privacy sentence about "het verwijderen van je gegevens op de server" therefore matches that button. The bug is the *other* button.

## 2. What changed from the 18 Nov comment

| # | Original claim | Verified state | Effect |
|---|---|---|---|
| 1 | The personal-data reset breaks the policy promise that "agent-geschiedenis" is deleted. | The policy sentence points at the **full** erase ("Servergegevens verwijderen"), which does delete the agent tables. The reset is a separate button: "Persoonlijke gegevens wissen" (`apps/web/src/views/Backup.tsx:166`, copy `apps/web/src/copy/admin.ts:1648`). | Still a real bug, but re-framed: it is a state-corrupting reset, not a broken policy promise. The reset leaves `agent_settings.enabled = true` with no `eb_sessions`. |
| 2 | An uncommitted worktree change moves the cron to one run at 07:00 UTC and ignores the chosen hour. | No such change exists on `master` or any local branch. `.worktrees/instinct-daily` does not exist. `master` runs an hourly GitHub Action (`.github/workflows/instinct-cron.yml`); the SQL selects `send_hour` with two retry hours (`db/migrations/0040_agent_due_users.sql:47-67`). | The send-time promise holds today. If a daily cron ships later, the consent, the UI and the policy must change together. |
| 3 | Neon processes data in the US, as the policy says. | The Neon project `lavega` (`royal-surf-52181032`) is `aws-eu-central-1`, proxy `c-5.eu-central-1.aws.neon.tech` (`neonctl projects list`, 18 Nov 2026). | The "Neon (VS)" row and the transfer sentence are wrong. Caveat: production `DATABASE_URL` is not in the repo, so confirm the linked project. |
| 4 | Resend region unknown. | Resend documents that "all account data, including email metadata, logs, and API records, is stored in the United States regardless of the sending region you select." | Resend belongs in the US transfer list, with that qualification. |
| 5 | The web-push library may encrypt the payload. | `web-push@4.0.0` (`apps/server/package.json:31`) encrypts the payload per the Web Push standard. The push service sees endpoint, timing, size and our server IP, not the text. | The text may say "versleuteld volgens de Web Push-standaard". |
| 6 | Account numbers may be stored; verify the shape. | The raw `accounts` array from the bank is stored (`eb-routes.ts:293`), and the mapper reads `account_id.iban` (`enableBankingMap.ts:43, 183`). | Upgrade from "probable" to "confirmed in code; production payload NV". |
| 7 | WhatsApp step 1 sends the scrubbed question. | It also sends today's date and the category names (`apps/server/src/whatsapp/reply.ts:270-275`). | Minor text omission; no merchant data. |
| 8 | The sent-key list can carry merchant strings. | It can: subscription keys are `${merchant}|out|${lastAmountCents}` (`packages/core/src/subscriptions.ts:1796`), reused as `deadline:renewal:<key>:<date>` (`packages/core/src/instinct/candidates.ts:151`), pruned after 30 days (`packages/core/src/instinct/tips.ts:20`). | Add it to "wat de server wel bewaart". |
| 9 | The policy says the login is deleted only on e-mail request. | `eraseUserData` also deletes `public."user"` and the auth identity rows (`packages/database/src/index.ts:1648-1667`). The UI button warns it deletes everything. | Mismatch between text and behaviour; the text must say the button removes the login too, or the button must not. |

## 3. Claim audit

### Daily message and bank read

| # | Claim in the text (nl) | What the code does | Verdict |
|---|---|---|---|
| 1 | "LaVega leest elke dag rond het tijdstip dat jij kiest je transacties…" | Hourly cron (`instinct-cron.yml`); `list_agent_due_users` selects `local_hour >= send_hour` within `RETRY_HOURS = 2` (`instinctCron.ts:27`, migration 0040). Default `sendHour = 8` (`AgentSettings.tsx:21`). | Match. Depends on the GitHub Action firing. |
| 2 | "…en ook wanneer je via WhatsApp een vraag stelt" | Bank read in `reply.ts:286-295`, capped by `WHATSAPP_FETCH_CAP = 3` (`instinct.ts:38`). The sentence applies to users who never link WhatsApp. | Match; bundling issue (section 5). |
| 3 | "LaVega bewaart je transacties niet." | Raw transactions are never stored. They live in memory inside `decide()` (`instinct.ts:101-160`); the tables hold none (migration 0039). The bank **session** row does store the account list. | Match for transactions; not for account numbers (row 6). |
| 4 | "De meldingen en antwoorden… blijven 90 dagen…" | `EVENT_RETENTION_DAYS = 90` (`packages/database/src/agent.ts:62`), purged per user after the run (`instinctCron.ts:85, 142-146`). Per-event and per-conversation deletes exist (`instinct-routes.ts:363-379`). | Match. Purge runs only when the cron reaches that user. |
| 5 | "…de transacties en saldi van de laatste 90 dagen… hoogstens één melding per dag" | `UNATTENDED_DAYS = 90` (`unattendedFetch.ts:24`); one day claim per Amsterdam date (`claimDay`, `instinct.ts:87`); one candidate per run. | Match. |
| 6 | "De transacties, saldi en rekeningnummers blijven alleen in het werkgeheugen…" | The session row stores `accounts: Array<Record>` (`eb-routes.ts:20-27, 293`), sealed, TTL `(MAX_CONSENT_DAYS 180 + 1)` days (`eb-routes.ts:68`). The mapper reads `account_id.iban`. | **Mismatch** for account numbers. |
| 7 | "Verloopt die toestemming, dan stoppen de meldingen… en zeggen we dat één keer." | Paused notice once (`instinct.ts:135-137`). A reminder is sent 7 days before expiry (`REMINDER_DAYS = 7`, `instinct.ts:33, 143-146`). | Match; the reminder is not in the text. |

### What is stored

| # | Claim | Code | Verdict |
|---|---|---|---|
| 8 | Settings, e-mail address, consent version | `consent_text_version`, `consented_at`, `channels_blob`, `email_blob` sealed (`agent.ts:263-298`). | Match. |
| 9 | Messages encrypted with our server key | `encryptBlob` AES-256-GCM with `LAVEGA_ENCRYPTION_KEY` (`apps/server/src/index.ts:115`); event body `{text: msg.long}` (`instinct.ts:267-273`). | Match. |
| 10 | Mirror: category rules, deadlines without amounts, one card figure | Mirror accepts `rules[{id, match, category}]` (max 500; `match` up to 200 chars of user-typed text), `dueDates[{kind, label, date}]` (VAT keeps its label; other labels become "Betaling te doen", `apps/web/src/agent/mirror.ts:65-75`), `cardOffer{name, yearlyGainCents, computedAt}` (`instinct-routes.ts:61-97`). Sent on opt-in and on every change while enabled (`useAgentMirror.ts:67-77`). | Imprecise. The rule text is words the user typed, often merchant names. The card name is stored. |
| 11 | Push subscription and a short list of what was already sent | Endpoint and keys sealed (`agent_push_subscriptions.subscription_blob`); `sent_keys_blob` holds keys such as `deadline:renewal:<merchant>|<amount>:<date>`, pruned after 30 days (`tips.ts:20`). | Match; the key list carries merchant and amount. |
| 12 | "Hoe lang. Meldingen bewaren we 90 dagen." | Settings, state, mirror, push subscription and WhatsApp number have no time limit. Only events and link attempts are purged. | Incomplete (art. 13(2)(a)). |
| 13 | Delivered copies stay in the mail, push or WhatsApp app | Plausible; outside our reach. | Match. |
| 14 | Phone number encrypted, plus a hash with its own key | `phone_blob` sealed; `phone_hash` = HMAC-SHA256 with `AGENT_PHONE_HMAC_KEY` (migration 0041; `agent.ts` link-code path). | Match. |
| 15 | Link code stored as hash, 15 minutes, replaced on next code/unlink/off | `LINK_CODE_MINUTES = 15` (`agent.ts:158`); upsert replaces (`agent.ts:472-479`); `unlink()` deletes both rows (`agent.ts:512-518`); `deleteAll` covers it. | Match. |

### WhatsApp and the AI filter

| # | Claim | Code | Verdict |
|---|---|---|---|
| 16 | Filter removes IBAN, e-mail, NL phone, BSN, amounts with € or EUR before; trailing currency stays | `scrubPersonalValues` (`packages/core/src/categorize.ts:154-162`). A BSN is removed only if it passes the elfproef (`:128-130`). Nothing else is filtered: names, health words, employer. | Match with an overclaim: only BSNs that pass the 11-proof are removed. Other free text reaches Mistral. |
| 17 | WhatsApp questions go to Mistral (EU) | `https://api.mistral.ai/v1` (`mistral.ts:5`). Step 1 sends the scrubbed question, today's date and the category names (`reply.ts:270-275`). Step 2 sends the question, computed facts and phrase lists (`reply.ts:336-340`). Processing location and retention: NV. | Match on endpoint; EU processing is a contract question. |
| 18 | Transactions, counterparty names, IBANs and balances are not sent; computed sentences are | Facts with bank text (`containsBankText`) skip step 2 (`reply.ts:329-332`). | Match. |
| 19 | Mistral writes nothing that reaches the user | The model returns indices (`parseSelection`); `composeAnswer` and `guardAnswer` build the message from fixed phrases (`reply.ts:352-364`). | Match. |
| 20 | Upcoming debits: all lines are sent | `reply.ts:329-331`. | Match. |
| 21 | Conversations 90 days; delete per message or conversation | Inbound stored in `agent_events` with the unfiltered text (`webhook.ts:224-233`); outbound stored (`reply.ts:225-233`). Deletes exist. | Match. Your typed questions are stored unfiltered; not stated. |

### Turning off, deleting, transfers

| # | Claim | Code | Verdict |
|---|---|---|---|
| 22 | Turning off deletes settings, messages, browser copy, push subscriptions, WhatsApp link with number, conversations and code | `PUT /api/agent/settings {enabled:false}` calls `repo.deleteAll()` (`instinct-routes.ts:223-226`), deleting the seven `AGENT_TABLES` rows (`agent.ts:618-626`). Push unsubscribe happens in the browser (`AgentSettings.tsx:372-397`). | Match. "De kopie uit je browser" is ambiguous; it means the server mirror. |
| 23 | Unlinking WhatsApp keeps conversations | `unlink()` deletes the link and codes only (`agent.ts:512-518`). | Match. |
| 24 | Resend delivers an e-mail | `sendAgentEmail` sends `subject: msg.title`, `text: msg.long` through `https://api.resend.com/emails` (`emailChannel.ts:28-32`, `authEmail.ts:22`). | Match. Resend stores account data and logs in the US. |
| 25 | The browser push service delivers a push | `sendPush` sends `{title, body: msg.short, url}`, TTL 24h, VAPID (`pushChannel.ts:32-45`). `web-push@4.0.0` encrypts the payload. | Match; the service still sees endpoint, timing, size and our IP. |
| 26 | A message names only data from your own transactions: a counterparty, an amount or a date | Renewal copy uses the detected counterparty and amount (`copy.ts:63-67`; `candidates.ts:124-141`); names are clipped to 40 characters (`render.ts:43-46`, `pushChannel.ts:16`). Tips are generic. | Match. Not stated: this text can appear on a lock screen and in an unencrypted mailbox. |
| 27 | The English paragraph makes the same claims | Same findings. | See above. |
| 28 | Lawful basis: consent for AI, daily message, WhatsApp | Stored as version plus timestamp; withdrawal by turning the feature off. | Match; the basis itself is a lawyer question. |
| 29 | "Jouw controle": server deletion removes backup, brokers, preferences, sync state, agent history and letters | `eraseServerData` → `DELETE /api/account/data` → `eraseUserData` (`packages/database/src/index.ts:1636-1667`). Includes all seven agent tables (`:1556-1563`) **and** `public."user"`. | Match for the erase button. The last sentence ("account itself on request by e-mail") is wrong: this route deletes the login. |
| 30 | Age 16+ | No age field or check in `SignUpForm.tsx`. | Statement only; not enforced. |
| 31 | Transfers: Vercel, Neon, Meta, OpenRouter with DPF or SCC; Mistral in the EU; TypeSafe and PostHog depend on configuration | No DPA, SCC or DPF evidence in the repo. `vercel.json:3` sets functions to `fra1`. Neon project is `aws-eu-central-1`. PostHog host is an env var (`apps/web/src/posthog.ts:4-5`). Resend and the push services are missing. | **Gap** (art. 13(1)(f)); the safeguard claim is NV. |
| 32 | PostHog receives no amounts or counterparties | No Instinct capture in the web or server path. The WhatsApp Mistral call passes no observability context, so `captureAiGeneration` returns early (`aiObservability.ts:57-65`; `reply.ts:229-235`). The generic web analytics still runs. | Match for Instinct. |
| 33 | GitHub Actions (not in the text) | The workflow calls the URL with a bearer secret and prints `{due, failed, skipped}` only. The route logs `userId` on a failure (`instinctCron.ts:140`). | No user data reaches GitHub. Vercel logs do see the user id. |

## 4. Article 13 checklist

| Item | Status | Where / why |
|---|---|---|
| Controller identity and contact (13(1)(a)) | Missing | "LaVega is de verwerkingsverantwoordelijke… Contact: alexander.steunenberg@gmail.com" (`legal.ts:135`). No legal form, Chamber of Commerce number or address. |
| DPO (13(1)(b)) | Not stated | Lawyer decides whether one is required. |
| Purposes (13(1)(c)) | Present, implied | The Instinct section describes the daily message; the word "doel" is not used. |
| Lawful basis per purpose | Present | `legal.ts:137-141`: consent for the daily message, contract for account and backup, legitimate interest for logs. Balancing test not stated. |
| Recipients named (13(1)(e)) | Mostly | Enable Banking, Resend, Meta, Mistral, Vercel, Neon, PostHog, Sentry in the bullet or table. Push services only in prose. Roles (processor or controller) not stated. |
| Transfers and safeguard (13(1)(f)) | Partial and partly wrong | "Vercel, Neon, Meta en OpenRouter… DPF of SCC" (`legal.ts:154`). Neon is EU. Resend and the push services are missing. "Hangt af van de configuratie" gives the reader nothing. |
| Retention (13(2)(a)) | Partial | 90 days is stated. Nothing for mirror, settings, push subscription, phone number, state, or an abandoned opt-in. |
| Rights and how to exercise them (13(2)(b)) | Present, incomplete | `legal.ts:165` lists the rights; no procedure and no one-month deadline. |
| Withdraw consent (13(2)(c)) | Present | "door de functie uit te zetten" (`legal.ts:140`). |
| Complaint to the AP (13(2)(d)) | Present | `legal.ts:165`. |
| Is providing data required (13(2)(e)) | Missing | Not said that Instinct is optional or that a bank link is required. |
| Automated decisions / profiling (13(2)(f)) | Missing | The card offer evaluates spending (art. 4(4) profiling) but has no legal or similarly significant effect, so art. 22 probably does not apply. A one-line statement is safer. Lawyer decides. |
| Source of data (art. 14) | Present | "via Enable Banking, alleen om te lezen". |
| Info at the point of collection | Missing | The consent screen has no link to `/privacy` (grep of `AgentSettings.tsx`). Sign-up does link it (`SignUpForm.tsx:129`). |

## 5. Consent quality (art. 7)

| Criterion | Fact | Assessment |
|---|---|---|
| Not pre-ticked | `useState(false)` for both consents (`AgentSettings.tsx:88, 94`). The feed box is checked and disabled (`:434`). | OK (V). |
| Unambiguous act | Checkbox plus "Zet aan"; the server rejects a mismatching version (`instinct-routes.ts:228-229`). | OK (V). |
| Informed | The sentence omits the mirror upload, merchant names and amounts in e-mail and push, the recipients, and the unattended read. | Weak. |
| Specific and granular | One checkbox covers feed, server bank read, mirror, e-mail, push and the WhatsApp read. Channels have separate boxes; the e-mail address and push permission are separate acts; WhatsApp has its own AI checkbox (`AgentSettings.tsx:508-517`). | Moderate. The channel boxes help. The WhatsApp sentence applies to users who never use WhatsApp. |
| Separate from other terms | Own block in settings; sign-up terms are separate. | OK. |
| As easy to withdraw | Turn-off is two clicks and deletes everything (`AgentSettings.tsx:372-397`). WhatsApp AI consent is withdrawn only by unlinking. | OK (V). |
| Versioned and logged | `consent_text_version`, `consented_at`, `ai_consent_at` stored. Not stored: the text itself, IP or user agent. Deleted on turn-off. | Partial. Lawyer decides whether a longer proof is needed. |
| Re-consent on change | Version mismatch skips the cron and the WhatsApp answer; the UI shows "Opnieuw toestemming nodig" (`AgentSettings.tsx:225`). A privacy-text change triggers nothing. | OK for the consent sentence only. |
| Push permission order | `togglePush` asks the browser for permission when the push box is ticked, before the consent box must be ticked (`AgentSettings.tsx:231-250`). The subscription is created only after save. | Minor. |

## 6. Push and the service worker

- The worker registers for every signed-in user (`Root.tsx:44-47`), before any opt-in. `sw.js` has only `push` and `notificationclick`, caches nothing, stores nothing and asks no permission.
- The browser permission prompt appears only from a settings click (`AgentSettings.tsx:238-245`). The subscription is created only after the server accepts the settings.
- An idle worker registration is a technical record that reads no user information. It is arguably strictly necessary for a feature the user may enable later. Confidence that this is fine: medium. Registering the worker only when push is ticked or saved removes the question and costs one condition in `Root.tsx:46`.
- The push payload is encrypted in transit to the browser, but the push service still sees the endpoint, the timing, the size and our server IP. That metadata is not described in the text.
- E-mail: the messages can name a product offer. Whether that is "electronic commercial communication" under Telecommunicatiewet 11.7 is a lawyer question. The footer links to settings, not to a one-click unsubscribe.

## 7. Must fix before real users are opted in

| # | Fact | Where | Smallest change |
|---|---|---|---|
| 1 | The consent sentence does not describe the processing: no mirror, no merchant names in e-mail or push, no recipients, WhatsApp bundled. | `instinctConsent.ts:7-10` | Text change plus bump `CONSENT_VERSION`. Proposal in section 10. Check the production DB first; if no user is opted in, the bump costs nothing. |
| 2 | "Persoonlijke gegevens wissen" leaves all seven agent tables. Instinct stays enabled with no bank link; history, mirror, push and phone number stay. | `index.ts:1683-1689` vs `:1556-1563`; `Backup.tsx:166` | Add the agent tables to `PERSONAL_RESET_TABLES` in child-first order, or call `AgentRepository.deleteAll` inside the reset. Add a test. |
| 3 | The bank session with the account list is stored sealed for up to 181 days; the text says account numbers stay in memory. | `eb-routes.ts:20-27, 68, 293`; `legal.ts:94` | Verify one production response, then change the text: the bank link (session and account list) is stored sealed until the bank consent ends. |
| 4 | The controller is "LaVega" with no entity, address or Chamber of Commerce number; the privacy contact is a Gmail address. | `legal.ts:15, 135` | Fill `[NOG INVULLEN]` fields. |
| 5 | Transfers: Resend and the push services are missing; Neon is listed as US but the project is in Frankfurt; "hangt af van de configuratie" is not an answer. | `legal.ts:130, 154` | Owner confirms regions and agreements, then a text change. |
| 6 | No statement on whether providing data is required, on profiling, or on how to exercise rights. | `legal.ts:162-165` | Text change. |
| 7 | No retention period for the mirror, settings, push subscription, phone number or an abandoned opt-in. | `legal.ts:144-151` | Text change now; auto-off after N days without a working bank link is a should-fix. |
| 8 | Merchant names and amounts reach a lock screen and an e-mail with no filter; the consent never says so. | `copy.ts:63-67`; `pushChannel.ts:32`; `sw.js:26` | Push body generic (no name, no amount), or at minimum the text warning plus a consent line. |
| 9 | The consent screen has no privacy-policy link. | `AgentSettings.tsx:401-421` | One link next to the consent sentence. |

## 8. Should fix

| # | Fact | Smallest change |
|---|---|---|
| 10 | The WhatsApp read sits inside the main consent sentence. | Move it to the WhatsApp AI checkbox text. |
| 11 | The filter text says "burgerservicenummers" and "telefoonnummers" without caveat; other free text reaches Mistral and is stored unfiltered. | Text change (section 10). |
| 12 | The worker registers before opt-in. | One condition in `Root.tsx:46`. |
| 13 | The text does not mention the 7-day expiry reminder. | Text change. |
| 14 | "De kopie uit je browser" is ambiguous. | Reword to "de kopie van je regels en deadlines op de server". |
| 15 | The policy says the login is deleted only on e-mail request, but `/api/account/data` deletes it. | Text change, or change the route. |
| 16 | No age gate; the text says 16+. | Add a sign-up statement or checkbox, or soften the text. |
| 17 | The 90-day purge runs per due user; a user skipped for budget keeps old events. | Global purge by `created_at` independent of the due list. |
| 18 | The consent record is deleted on turn-off; the consent text is not stored with it. | Optional minimal log. Lawyer decides. |
| 19 | `userId` appears in Vercel logs on failure; `agent_link_attempts` holds HMACs of numbers of non-users for 15 minutes. | Mention in the text or accept. |
| 20 | ADR 0014 and `channel.ts:34-48` prune a stale WhatsApp link only when a daily send is attempted on that channel. | Docs note. |
| 21 | `mistral.ts:181` logs up to 2000 characters of an unexpected response. For Instinct that is an index JSON. | Optional hardening. |

## 9. Ask a lawyer

1. **Lawful basis.** Is consent right for the daily message, or contract or legitimate interest? Is one consent for a bundle of channels enough? Is the card or rate offer in e-mail commercial communication under Tw 11.7?
2. **DPIA (art. 35).** Is one needed for systematic nightly processing of bank transactions plus profiling for offers? The AP list decides.
3. **Processor agreements.** Which are signed: Resend, Neon, Vercel, Mistral, Meta WhatsApp Business, PostHog, Sentry, OpenRouter, TypeSafe, Cloudflare, n8n, Enable Banking? Is Enable Banking a processor or its own controller? Is Meta a processor, joint controller or independent controller? Are the push services independent controllers?
4. **Transfers.** For US processors (Vercel, Resend, Meta, OpenRouter): DPF certification or SCC plus a transfer impact assessment? Do the push services outside the EEA need a stated safeguard? How should Neon be described now that the database runs in Frankfurt?
5. **Special categories (art. 9).** Does displaying a payee such as a health insurer, union, church or political party count as processing special-category data? If yes, which condition applies, and is a filter or warning required? Exposure points: rule texts, renewal names, e-mail and lock-screen push.
6. **Unattended reads.** Does the user's PSD2 consent cover a server reading without the user present, and is one daily read within Enable Banking's terms?
7. **Minimum age.** Is 16 the right threshold, and is a statement enough or is a check required?
8. **Controller entity and DPO.** Which legal entity is the controller, and is a DPO required?

## 10. Proposed Dutch text

Blanks are marked `[NOG INVULLEN: …]`. Nothing about locations, retention or legal basis is invented. Basis is consent, as the policy table already says.

### Consent sentence (next version)

> LaVega leest elke dag rond het tijdstip dat jij kiest je transacties en saldi van de laatste 90 dagen bij je bank, zonder dat jij erbij bent, om je melding te maken. Die transacties en saldi bewaren we niet. Wel bewaren we je instellingen, een kopie van je categorieregels en de data van naderende deadlines die je browser ons doorgeeft, en de meldingen zelf, 90 dagen. Een melding kan de naam van een tegenpartij, een bedrag en een datum noemen, en komt via de kanalen die jij kiest: in LaVega, per e-mail (via Resend), als pushmelding (via de pushdienst van je browser) of via WhatsApp (via Meta). Een pushmelding kan zichtbaar zijn op je vergrendelscherm. Je kunt dit op elk moment uitzetten; dan verwijderen we alles. Meer staat in het privacybeleid.

### WhatsApp AI consent line

> Stel je via WhatsApp een vraag, dan leest LaVega op dat moment ook je transacties, hoogstens 3 keer per dag. Je vraag kan andere persoonlijke informatie bevatten die onze filter niet herkent; die gaat dan ook naar Mistral.

### Privacy section "Dagelijkse melding"

> **Wie is verantwoordelijk.** [NOG INVULLEN: bedrijfsnaam, rechtsvorm, KvK-nummer, adres] is verwerkingsverantwoordelijke. Contact: [NOG INVULLEN: privacy-adres].
>
> **Waarom en op welke grondslag.** Om je elke dag een korte melding over je geld te sturen. Grondslag: jouw toestemming (art. 6 lid 1 sub a AVG). Het is vrijwillig: LaVega werkt ook zonder deze functie. Je trekt je toestemming in door de melding uit te zetten.
>
> **Wat de server leest.** Voor gebruikers die dit hebben aangezet leest de server één keer per dag, rond het tijdstip dat jij koos (standaard 08:00, Nederlandse tijd), de transacties en saldi van de laatste 90 dagen bij je bank via Enable Banking, alleen om te lezen. Dit gebeurt zonder dat jij erbij bent, binnen de toestemming die je bij je bank gaf. Daaruit kiest de server hoogstens één melding per dag. Stel je via WhatsApp een vraag waarvoor gegevens nodig zijn, dan leest de server je transacties ook op dat moment, hoogstens 3 keer per dag. Zeven dagen voordat je bankkoppeling verloopt, sturen we één herinnering. Is hij verlopen, dan pauzeren de meldingen en zeggen we dat één keer.
>
> **Wat de server niet bewaart.** De transacties en saldi van die run blijven alleen in het werkgeheugen en komen niet in de database of in logboeken. Wel bewaren we versleuteld de bankkoppeling: de sessie en de rekeninglijst die je bank terugstuurt, inclusief rekeningnummers, zolang je toestemming bij je bank loopt, tot ten hoogste 181 dagen. De server heeft die nodig om te kunnen lezen.
>
> **Wat de server wel bewaart.** (1) Je instelling: aan of uit, kanalen, tijdstip, taal, je e-mailadres als je e-mail koos, de versie en het tijdstip van je toestemming. (2) De meldingen en WhatsApp-berichten, ook de vragen die jij stuurt, zoals jij ze typte, versleuteld met onze serversleutel, 90 dagen. Een melding kan een naam van een tegenpartij, een bedrag en een datum noemen. (3) Een kopie van wat je browser ons doorgeeft: de teksten van je categorieregels (woorden die jij zelf typte, vaak namen van winkels), de data en namen van naderende deadlines (BTW-deadlines met hun naam, overige deadlines zonder naam) en de naam van een betere kaart met het jaarlijkse voordeel. Je browser ververst die kopie elke keer dat je regels veranderen. (4) Een pushabonnement als je pushmeldingen koos. (5) Een korte lijst van wat we je al meldden, 30 dagen, zodat we niets herhalen; die lijst kan een winkelnaam en een bedrag bevatten.
>
> **Hoe lang.** Meldingen en WhatsApp-berichten: 90 dagen, of eerder als je ze verwijdert. Instelling, kopie van je regels en deadlines, pushabonnement en WhatsApp-nummer: tot je de melding uitzet, het nummer ontkoppelt of je account verwijdert. [NOG INVULLEN: automatisch verwijderen na … dagen zonder werkende bankkoppeling, als je dat besluit.]
>
> **Wat een melding laat zien.** Een e-mail of pushmelding kan de naam van een tegenpartij en een bedrag noemen, bijvoorbeeld bij een abonnement dat wordt verlengd. Een pushmelding kan op je vergrendelscherm staan. We filteren die namen niet op gevoelige onderwerpen. Wil je dat niet, kies dan alleen "In LaVega".
>
> **Wie erbij betrokken is.** Enable Banking levert de bankgegevens. Resend (VS; accountgegevens en logboeken staan in de VS) bezorgt e-mail met de volledige tekst van de melding. De pushdienst van je browser (Google, Apple of Mozilla) bezorgt een pushmelding met de titel en de korte tekst, versleuteld volgens de Web Push-standaard; deze dienst ziet wel wanneer en hoe vaak, en het adres van onze server. Meta bezorgt WhatsApp-berichten, inclusief de korte tekst met naam en bedrag. Mistral (EU) krijgt alleen je gefilterde WhatsApp-vraag, de datum van vandaag, de categorienamen en de door ons uitgerekende zinnen. Hosting: Vercel, functieregio Frankfurt (`vercel.json:3`; bedrijf in de VS). Database: Neon, regio Frankfurt (`aws-eu-central-1`).
>
> **WhatsApp-filter.** Voordat je vraag naar Mistral gaat, halen we eruit: rekeningnummers (IBAN, elk land), e-mailadressen, Nederlandse telefoonnummers (06…, 010… en +31), burgerservicenummers die de elfproef doorstaan, en bedragen met € of EUR ervoor (zoals € 45). Een bedrag met het valutateken erachter, zoals 45 EUR of 45€, blijft staan. Andere persoonlijke informatie die je zelf typt, zoals een naam of een ziekte, herkennen we niet en gaat mee.
>
> **Uitzetten en je rechten.** Zet je de melding uit, dan verwijderen we in één keer je instelling, je meldingen en WhatsApp-berichten, de kopie van je regels en deadlines, je pushabonnementen en je WhatsApp-koppeling met nummer en koppelcode. Dat is niet terug te draaien. "Servergegevens verwijderen" doet hetzelfde en verwijdert ook je inlog. Je hebt recht op inzage, correctie, verwijdering, beperking, bezwaar en overdraagbaarheid; mail [NOG INVULLEN: privacy-adres], we reageren binnen een maand. Je kunt een klacht indienen bij de Autoriteit Persoonsgegevens. Er is geen geautomatiseerd besluit met rechtsgevolgen; de suggestie voor een betere kaart is een berekening op basis van je uitgaven en geen besluit. [Lawyer: confirm this sentence.]
>
> **Doorgifte.** [NOG INVULLEN: per verwerker regio, en of DPF of standaardcontractbepalingen gelden; Resend en de pushdiensten toevoegen; Neon als EU opnemen.]

## 11. Open unknowns

These stay open until someone checks them outside the repository:

- Whether any processor agreement exists with Resend, Neon, Vercel, Mistral, Meta, PostHog, Sentry, OpenRouter, TypeSafe, Cloudflare, n8n or Enable Banking.
- Which Neon project production actually links. The only local project named `lavega` is in `aws-eu-central-1`; `.env.local` and `.env.vercel` both hold `[SENSITIVE]` placeholders.
- The PostHog and TypeSafe regions (env vars; values not in the repo).
- Mistral's processing location and retention terms. The repo proves only the API URL.
- The exact `accounts` payload Enable Banking returns in production. The adapter expects `account_id.iban`, but no live response was inspected.
- Whether any production user is already opted in. The production database is not readable from the repo; the consent-version bump is free only if the answer is no.
- Vercel runtime-log retention on the current plan, and whether the `userId` in `instinctCron.ts:140` survives long enough to matter.
- That `web-push@4.0.0` encrypts the payload. This is documented library behaviour, not repo code.
- Whether every error path is free of amounts and merchant names. `instinct.ts`, `instinctCron.ts`, `reply.ts`, `webhook.ts`, `channel.ts`, `emailChannel.ts` and `pushChannel.ts` were read and none was found.

No production service was called for this review.

## 12. Evidence log

Read at `955972d17`:

- `apps/server/src/legal.ts`
- `apps/server/src/instinctConsent.ts`
- `apps/server/src/instinct-routes.ts`
- `apps/server/src/account-routes.ts`
- `apps/server/src/agent/instinct.ts`
- `apps/server/src/agent/instinctCron.ts`
- `apps/server/src/agent/emailChannel.ts`
- `apps/server/src/agent/pushChannel.ts`
- `apps/server/src/agent/aiObservability.ts`
- `apps/server/src/agent/mistral.ts`
- `apps/server/src/agent/unattendedFetch.ts`
- `apps/server/src/whatsapp/reply.ts`
- `apps/server/src/whatsapp/webhook.ts`
- `apps/server/src/whatsapp/channel.ts`
- `packages/database/src/agent.ts`
- `packages/database/src/index.ts`
- `packages/core/src/instinct/*`
- `packages/core/src/subscriptions.ts`
- `packages/core/src/categorize.ts`
- `packages/adapters/src/banking/enableBankingMap.ts`
- `apps/web/src/views/AgentSettings.tsx`
- `apps/web/src/views/Backup.tsx`
- `apps/web/src/copy/instinct.ts`
- `apps/web/src/copy/admin.ts`
- `apps/web/src/agent/mirror.ts`
- `apps/web/src/agent/useAgentMirror.ts`
- `apps/web/src/agent/pushBrowser.ts`
- `apps/web/src/swRegistration.ts`
- `apps/web/src/Root.tsx`
- `apps/web/public/sw.js`
- `db/migrations/0039-0041`
- `docs/adr/0009-account-held-vault-key.md`
- `docs/adr/0014-server-reads-transactions-at-night.md`
- `DEPLOY.md`
- `.github/workflows/instinct-cron.yml`
- `vercel.json`, `scripts/vercel-build.mjs`

External checks on 18 Nov 2026:

- `neonctl projects list` (project `lavega`, `aws-eu-central-1`).
- Resend docs, "Data Residency" (`resend.com/docs/dashboard/domains/regions`).
