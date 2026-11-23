# Instinct privacy gap check (verified)

|                  |                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What this is** | A check of the Instinct privacy text and consent wording against the code. Not legal advice. Not a legal sign-off.                                                                                             |
| **Blocker**      | GitHub issue #348 stays open until a lawyer answers the "Ask a lawyer" list.                                                                                                                                   |
| **Reviewed at**  | `master`, commit `f39527e27`, 18 Nov 2026. Consent v3 and the push/reset fixes landed in `10ffbffa3` while this review was being written; this version reflects them. Line numbers move; re-check after edits. |
| **Supersedes**   | The 18 Nov 2026 comment by the cofounder. Section 2 lists what that comment got wrong or stale.                                                                                                                |
| **Legend**       | **V** = verified in code at `file:line`. **NV** = not verifiable from this repository. **Mismatch** = the text promises something the code does not do.                                                        |

## 1. Bottom line

Consent v3 (`2026-11-v3`) and the merged fixes closed most of the earlier findings. The consent now names the mirror, counterparty names and amounts, the channels, the unattended read and the generic push. Push carries no names or amounts. The privacy-policy link is on the consent screen. The personal reset now deletes the seven agent tables. Retention for settings, mirror, push subscription and phone number is stated.

What remains:

1. **Account numbers are still described as memory-only.** The Enable Banking session row stores the raw account list (`apps/server/src/eb-routes.ts:20-27, 293`), sealed, with a TTL of 181 days (`eb-routes.ts:68`). The adapter reads `account_id.iban` (`packages/adapters/src/banking/enableBankingMap.ts:43, 183`). The live response shape is NV, but the code is built for IBANs.
2. **The controller is still unidentified.** "LaVega" with a Gmail address, no legal form, address or Chamber of Commerce number (`legal.ts:15, 135`).
3. **The transfer section is wrong and incomplete.** It lists Neon as US although the `lavega` Neon project runs in `aws-eu-central-1`. Resend and the browser push services are missing. "Voor TypeSafe en PostHog hangt de regio af van de configuratie" tells the reader nothing (`legal.ts:154`).
4. **Article 13 still misses three statements:** whether providing data is required, whether there is profiling or automated decision-making, and how to exercise the rights (procedure and one-month deadline).
5. **The login-deletion sentence contradicts the route.** `legal.ts:164` says the login is deleted only on request by e-mail; `eraseUserData` deletes `public."user"` and the auth rows (`packages/database/src/index.ts:1648-1667`).

The age statement (16+) is still not enforced anywhere.

## 2. What changed since the 18 Nov comment

### Corrections to the comment

| #   | Original claim                                                                                     | Verified state                                                                                                                                                                                                                                                                                                                | Effect                                                                                 |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | The personal-data reset breaks the policy promise that "agent-geschiedenis" is deleted.            | True at `955972d17`, fixed in `10ffbffa3`: `PERSONAL_RESET_TABLES` now includes the seven agent tables (`packages/database/src/index.ts:1683-1698`) and a test covers it (`packages/database/src/personal-reset.test.ts:24-31`).                                                                                              | Resolved.                                                                              |
| 2   | An uncommitted worktree change moves the cron to one run at 07:00 UTC and ignores the chosen hour. | The change is now **committed**: one Vercel cron at `0 7 * * *` (`scripts/vercel-build.mjs:312-319`), `FULL_DAY_HOUR = 23`, `FULL_DAY_RETRY_HOURS = 23` (`instinctCron.ts:31-32`). The text was changed with it: "elke ochtend", "tussen 08:00 en 10:00", no time picker (`copy/instinct.ts:91-98`, `AgentSettings.tsx:563`). | No mismatch. `sendHour` is still stored and sent but ignored; dead config to clean up. |
| 3   | Neon processes data in the US, as the policy says.                                                 | Neon project `lavega` is `aws-eu-central-1`, proxy `c-5.eu-central-1.aws.neon.tech` (`neonctl projects list`, 18 Nov 2026).                                                                                                                                                                                                   | Policy still wrong. Confirm the production project.                                    |
| 4   | Resend region unknown.                                                                             | Resend documents that "all account data, including email metadata, logs, and API records, is stored in the United States regardless of the sending region you select."                                                                                                                                                        | Add Resend to the US transfer list.                                                    |
| 5   | Merchant names and amounts reach a lock screen.                                                    | Fixed: push sends a fixed generic text (`GENERIC`, `pushChannel.ts:15-19, 39`). Only e-mail and WhatsApp carry the detail, and the policy says so.                                                                                                                                                                            | Resolved.                                                                              |
| 6   | The consent screen has no privacy-policy link.                                                     | Fixed: link at `AgentSettings.tsx:411-415`, copy `copy/instinct.ts:93`.                                                                                                                                                                                                                                                       | Resolved.                                                                              |
| 7   | The consent sentence does not describe the mirror, merchant data, recipients or unattended read.   | Fixed in v3: the sentence names the mirror, counterparty/amount/date, the channels, the unattended read and the generic push (`instinctConsent.ts:5-9`).                                                                                                                                                                      | Mostly resolved. One checkbox still covers all channels; lawyer question.              |
| 8   | Retention is missing for mirror, settings, push subscription and phone number.                     | Fixed in the policy: "Hoe lang" now states it (`legal.ts:96`).                                                                                                                                                                                                                                                                | Resolved in text.                                                                      |

### Verified facts added to the comment

| #   | Fact                                                                                                                                                                                | Where                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 9   | `web-push@4.0.0` encrypts the payload. The push service sees endpoint, timing, size and our IP only.                                                                                | `apps/server/package.json:31`; `pushChannel.ts:39` |
| 10  | The sent-key list carries merchant and amount: `${merchant}                                                                                                                         | out                                                | ${lastAmountCents}`, reused as a renewal key, pruned after 30 days. | `packages/core/src/subscriptions.ts:1796`; `candidates.ts:151`; `tips.ts:20` |
| 11  | WhatsApp step 1 also sends today's date and the category names.                                                                                                                     | `apps/server/src/whatsapp/reply.ts:270-275`        |
| 12  | Full erase deletes the login.                                                                                                                                                       | `packages/database/src/index.ts:1648-1667`         |
| 13  | The 90-day purge runs after each user's run, and the daily listing now covers all enabled users. A time-budget skip rotates the start order, so a user can exceed 90 days by a day. | `instinctCron.ts:126-153`                          |

## 3. Claim audit at `706d0b05b`

### Consent sentence

| #   | Claim (nl)                                                                                                                                                     | Code                                                                                                                          | Verdict                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | "LaVega leest elke ochtend je transacties en saldi van de laatste 90 dagen bij je bank, zonder dat jij erbij bent, om hoogstens één melding per dag te maken." | One Vercel cron at 07:00 UTC; `UNATTENDED_DAYS = 90`; one claim per Amsterdam date (`instinct.ts:87`); one candidate per run. | Match.                                                                       |
| 2   | "Die transacties en saldi bewaren we niet."                                                                                                                    | Transactions are never stored; the session row stores the account list, not transactions.                                     | Match for transactions.                                                      |
| 3   | "Wel bewaren we je instellingen, een kopie van je categorieregels en naderende deadlines … en de meldingen zelf, 90 dagen."                                    | Settings, mirror and events (`agent_settings`, `agent_mirror`, `agent_events`); `EVENT_RETENTION_DAYS = 90`.                  | Match. The mirror stores user-typed rule text, VAT labels and the card name. |
| 4   | "Een melding kan de naam van een tegenpartij, een bedrag en een datum noemen en komt via de kanalen die jij kiest…"                                            | Renewal copy uses the counterparty and amount (`copy.ts:63-67`); channels are chosen separately.                              | Match.                                                                       |
| 5   | "Een pushmelding zegt alleen dat er een bericht is."                                                                                                           | `GENERIC` title/body; no name, amount or date (`pushChannel.ts:15-19, 39`).                                                   | Match.                                                                       |
| 6   | "Je kunt dit op elk moment uitzetten; dan verwijderen we alles."                                                                                               | `deleteAll()` removes the seven agent tables (`instinct-routes.ts:223-226`; `agent.ts:618-626`).                              | Match, except delivered copies, which the policy excludes.                   |

### Policy bullets

| #   | Claim (nl)                                                                                                                   | Code                                                                                                                                  | Verdict                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 7   | "één keer per dag, in de ochtend (tussen 08:00 en 10:00 Nederlandse tijd)"                                                   | 07:00 UTC = 08:00 CET / 09:00 CEST. `FULL_DAY_*` makes every stored `send_hour` due.                                                  | Match. A long Vercel delay could pass 10:00, but the run is one shot. |
| 8   | "Mislukt een poging, dan proberen we het de volgende dag opnieuw."                                                           | A failed run releases the day claim; the next cron run is the next day.                                                               | Match.                                                                |
| 9   | "zeven dagen voordat je bankkoppeling verloopt één herinnering"                                                              | `REMINDER_DAYS = 7`, `instinct.ts:33, 143-146`.                                                                                       | Match.                                                                |
| 10  | "Stel je via WhatsApp een vraag … hoogstens 3 keer per dag."                                                                 | `WHATSAPP_FETCH_CAP = 3`, `reply.ts:291`.                                                                                             | Match.                                                                |
| 11  | "De transacties, saldi en rekeningnummers blijven alleen in het werkgeheugen…"                                               | `eb_sessions.payload_blob` stores the bank session with `accounts: Array<Record>` (`eb-routes.ts:20-27, 293`), sealed, TTL 181 days.  | **Mismatch** for account numbers.                                     |
| 12  | "een korte lijst van wat we je al meldden, 30 dagen"                                                                         | `sent_keys_blob`, pruned after 30 days (`tips.ts:20`).                                                                                | Match; keys can carry merchant and amount.                            |
| 13  | "Je instelling, de kopie … pushabonnement en WhatsApp-nummer bewaren we tot je uitzet, ontkoppelt of je account verwijdert." | No TTL on those rows; `deleteAll` and `unlink` clear them.                                                                            | Match.                                                                |
| 14  | "Je vragen via WhatsApp bewaren we zoals je ze typte, dus zonder het filter."                                                | Inbound text stored raw (`webhook.ts:224-233`).                                                                                       | Match.                                                                |
| 15  | Filter list: IBAN, e-mail, NL phone, BSN that passes the elfproef, amounts with € or EUR in front; other text goes along.    | `scrubPersonalValues` (`categorize.ts:154-162`).                                                                                      | Match.                                                                |
| 16  | "Vragen … gaan naar Mistral (EU)"                                                                                            | `https://api.mistral.ai/v1` (`mistral.ts:5`).                                                                                         | Endpoint match; EU processing and retention are NV.                   |
| 17  | "Mistral schrijft zelf niets dat naar jou wordt gestuurd."                                                                   | Model returns indices; `composeAnswer`/`guardAnswer` build from fixed phrases (`reply.ts:352-364`).                                   | Match.                                                                |
| 18  | "Uitzetten … verwijdert … de kopie van je regels en deadlines op onze server…"                                               | `deleteAll` removes `agent_mirror` and the rest.                                                                                      | Match.                                                                |
| 19  | "de pushdienst … krijgt een generieke tekst zonder namen of bedragen"                                                        | `pushChannel.ts:15-19, 39`.                                                                                                           | Match.                                                                |
| 20  | "Jouw controle … agent-geschiedenis"                                                                                         | Full erase deletes all seven agent tables (`index.ts:1556-1563`).                                                                     | Match for "Servergegevens verwijderen".                               |
| 21  | "Je account zelf (je inlog) verwijderen we op verzoek — stuur een bericht."                                                  | The same erase route deletes `public."user"` and auth rows (`index.ts:1648-1667`).                                                    | **Mismatch.**                                                         |
| 22  | "LaVega is bedoeld voor mensen van 16 jaar en ouder."                                                                        | No age field or check in `SignUpForm.tsx`.                                                                                            | Statement only.                                                       |
| 23  | "Vercel, Neon, Meta en OpenRouter … DPF of SCC … TypeSafe en PostHog hangt af van de configuratie."                          | `vercel.json:3` = `fra1`; Neon = `aws-eu-central-1`; PostHog host is an env var (`posthog.ts:4-5`). Resend and push services missing. | **Wrong and incomplete.**                                             |

### Other checks

| #   | Check                                  | Result                                                                                                                           |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 24  | Personal reset deletes agent data      | Fixed (`index.ts:1683-1698`; test `personal-reset.test.ts:24-31`).                                                               |
| 25  | PostHog receives no Instinct data      | No Instinct capture in web or server. WhatsApp passes no observability context (`aiObservability.ts:57-65`; `reply.ts:229-235`). |
| 26  | GitHub Actions sees no user data       | Workflow is manual only and prints counters. The route logs `userId` on failure (`instinctCron.ts:149`).                         |
| 27  | Turning off removes the server mirror  | `deleteAll` includes `agent_mirror`.                                                                                             |
| 28  | Service worker registers before opt-in | `Root.tsx:44-47`; no permission, no cache, no storage (`sw.js`).                                                                 |

## 4. Article 13 checklist

| Item                                       | Status                   | Where / why                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller identity and contact (13(1)(a)) | Missing                  | "LaVega is de verwerkingsverantwoordelijke… Contact: alexander.steunenberg@gmail.com" (`legal.ts:135`). No legal form, Chamber of Commerce number or address.                                |
| DPO (13(1)(b))                             | Not stated               | Lawyer decides whether one is required.                                                                                                                                                      |
| Purposes (13(1)(c))                        | Present                  | The daily-message section describes the purpose; the lawful-basis table names the processing.                                                                                                |
| Lawful basis per purpose                   | Present                  | `legal.ts:137-141`: consent for the daily message, contract for account and backup, legitimate interest for logs. Balancing test not stated.                                                 |
| Recipients named (13(1)(e))                | Mostly                   | Enable Banking, Resend, Meta, Mistral, Vercel, Neon, PostHog, Sentry. Push services named in the Instinct bullet. Roles (processor or controller) not stated.                                |
| Transfers and safeguard (13(1)(f))         | Partial and partly wrong | Neon is EU, not US. Resend and the push services are missing. "Hangt af van de configuratie" is not an answer (`legal.ts:154`).                                                              |
| Retention (13(2)(a))                       | Present for Instinct     | 90 days for messages; settings, mirror, push subscription and phone number until off, unlink or delete (`legal.ts:96`). No automatic expiry for an abandoned opt-in.                         |
| Rights and how to exercise them (13(2)(b)) | Present, incomplete      | `legal.ts:165` lists the rights; no procedure and no one-month deadline.                                                                                                                     |
| Withdraw consent (13(2)(c))                | Present                  | "door de functie uit te zetten" (`legal.ts:140`).                                                                                                                                            |
| Complaint to the AP (13(2)(d))             | Present                  | `legal.ts:165`.                                                                                                                                                                              |
| Is providing data required (13(2)(e))      | Missing                  | Not said that Instinct is optional or that a bank link is required.                                                                                                                          |
| Automated decisions / profiling (13(2)(f)) | Missing                  | The card offer evaluates spending (art. 4(4) profiling) but has no legal or similarly significant effect, so art. 22 probably does not apply. A one-line statement is safer. Lawyer decides. |
| Source of data (art. 14)                   | Present                  | "via Enable Banking, alleen om te lezen".                                                                                                                                                    |
| Info at the point of collection            | Present                  | Consent screen links to `/privacy` (`AgentSettings.tsx:411-415`).                                                                                                                            |

## 5. Consent quality (art. 7)

| Criterion                 | Fact                                                                                                                                                                                                                                                | Assessment                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Not pre-ticked            | `useState(false)` for both consents (`AgentSettings.tsx:87-94`). The feed box is checked and disabled (`:439`).                                                                                                                                     | OK (V).                                                                       |
| Unambiguous act           | Checkbox plus "Zet aan"; the server rejects a mismatching version (`instinct-routes.ts:228-229`).                                                                                                                                                   | OK (V).                                                                       |
| Informed                  | v3 names the mirror, merchant data, channels, unattended read and generic push; the screen links the policy. Processor names and regions sit in the policy only.                                                                                    | Adequate; lawyer decides.                                                     |
| Specific and granular     | One checkbox covers feed, the server bank read, mirror, e-mail, push and the WhatsApp read. Channels have separate boxes; the e-mail address and push permission are separate acts; WhatsApp has its own AI checkbox (`AgentSettings.tsx:513-520`). | Moderate. Lawyer decides whether one consent for the daily message is enough. |
| Separate from other terms | Own block in settings; sign-up terms are separate.                                                                                                                                                                                                  | OK.                                                                           |
| As easy to withdraw       | Turn-off is two clicks and deletes everything (`AgentSettings.tsx:372-397`). WhatsApp AI consent is withdrawn only by unlinking.                                                                                                                    | OK (V).                                                                       |
| Versioned and logged      | `consent_text_version = 2026-11-v3`, `consented_at`, `ai_consent_at` stored. Not stored: the text itself, IP or user agent. Deleted on turn-off.                                                                                                    | Partial. Lawyer decides whether a longer proof is needed.                     |
| Re-consent on change      | A version mismatch skips the cron and the WhatsApp answer; the UI shows "Opnieuw toestemming nodig" (`AgentSettings.tsx:225`). A privacy-text change triggers nothing.                                                                              | OK for the consent sentence only.                                             |
| Push permission order     | `togglePush` asks the browser for permission when the push box is ticked, before the consent box must be ticked (`AgentSettings.tsx:231-250`). The subscription is created only after save.                                                         | Minor.                                                                        |

## 6. Push and the service worker

- The payload is generic: title "LaVega", body "Je hebt een nieuwe melding." / "You have a new message." (`pushChannel.ts:15-19`). No name, amount or date reaches the push service or a lock screen.
- `web-push@4.0.0` encrypts the payload. The push service still sees the endpoint, timing, size and our server IP. The policy does not describe that metadata.
- The worker registers for every signed-in user (`Root.tsx:44-47`), before any opt-in. `sw.js` has only `push` and `notificationclick`, caches nothing, stores nothing and asks no permission.
- The browser permission prompt appears only from a settings click (`AgentSettings.tsx:238-245`). The subscription is created only after the server accepts the settings.
- An idle worker registration is a technical record that reads no user information. It is arguably strictly necessary for a feature the user may enable later. Registering the worker only when push is ticked or saved removes the question and costs one condition in `Root.tsx:46`.
- E-mail: the messages can name a product offer. Whether that is "electronic commercial communication" under Telecommunicatiewet 11.7 is a lawyer question. The footer links to settings, not to a one-click unsubscribe.

## 7. Must fix before real users are opted in

| #   | Fact                                                                                                                                                        | Where                                        | Smallest change                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The bank session stores the raw account list; the text says account numbers stay in memory.                                                                 | `eb-routes.ts:20-27, 68, 293`; `legal.ts:94` | Verify one production response, then say: the bank link (session and account list, including account numbers) is stored sealed until the bank consent ends, at most 181 days. |
| 2   | The controller is "LaVega" with no entity, address or Chamber of Commerce number; the privacy contact is a Gmail address.                                   | `legal.ts:15, 135`                           | Fill the `[NOG INVULLEN]` fields in section 10.                                                                                                                               |
| 3   | Transfers: Resend and the push services are missing; Neon is listed as US but the project is in Frankfurt; "hangt af van de configuratie" is not an answer. | `legal.ts:130, 154`                          | Owner confirms regions and agreements, then a text change.                                                                                                                    |
| 4   | No statement on whether providing data is required, or on profiling.                                                                                        | `legal.ts:144-165`                           | Two sentences.                                                                                                                                                                |
| 5   | No procedure or deadline for exercising rights.                                                                                                             | `legal.ts:165`                               | One sentence: mail the privacy address, answer within a month.                                                                                                                |
| 6   | The policy says the login is deleted only on request by e-mail, but `/api/account/data` deletes it.                                                         | `legal.ts:164`; `index.ts:1648-1667`         | Text change, or change the route.                                                                                                                                             |

## 8. Should fix

| #   | Fact                                                                                                             | Smallest change                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 7   | No age gate; the text says 16+.                                                                                  | Add a sign-up statement or checkbox, or soften the text.               |
| 8   | `sendHour` is still stored and sent, but ignored; the UI silently sends `DEFAULT_HOUR = 8`.                      | Remove the field from the API and settings, or comment it as reserved. |
| 9   | The worker registers before opt-in.                                                                              | One condition in `Root.tsx:46`.                                        |
| 10  | The consent record is deleted on turn-off; the consent text is not stored with it.                               | Optional minimal log. Lawyer decides.                                  |
| 11  | A user skipped for the 300 s budget can exceed 90 days by a day; the start order rotates.                        | Accept, or run a global purge by `created_at`.                         |
| 12  | `userId` appears in Vercel logs on failure.                                                                      | Short retention on Hobby; accept or hash the id.                       |
| 13  | `mistral.ts:181` logs up to 2000 characters of an unexpected response. For Instinct that is an index JSON.       | Optional hardening.                                                    |
| 14  | The push service metadata (timing, size, server IP) is not described.                                            | One clause in "Wie erbij betrokken is".                                |
| 15  | ADR 0014 and `channel.ts:34-48` prune a stale WhatsApp link only when a daily send is attempted on that channel. | Docs note.                                                             |

## 9. Ask a lawyer

1. **Lawful basis.** Is consent right for the daily message, or contract or legitimate interest? Is one consent for a bundle of channels and the mirror enough? Is the card or rate offer in e-mail commercial communication under Tw 11.7?
2. **DPIA (art. 35).** Is one needed for systematic nightly processing of bank transactions plus profiling for offers? The AP list decides.
3. **Processor agreements.** Which are signed: Resend, Neon, Vercel, Mistral, Meta WhatsApp Business, PostHog, Sentry, OpenRouter, TypeSafe, Cloudflare, n8n, Enable Banking? Is Enable Banking a processor or its own controller? Is Meta a processor, joint controller or independent controller? Are the push services independent controllers?
4. **Transfers.** For US processors (Vercel, Resend, Meta, OpenRouter): DPF certification or SCC plus a transfer impact assessment? Do the push services outside the EEA need a stated safeguard? How should Neon be described now that the database runs in Frankfurt?
5. **Special categories (art. 9).** Does displaying a payee such as a health insurer, union, church or political party count as processing special-category data? If yes, which condition applies, and is a filter or warning required? Exposure points: rule texts, renewal names, e-mail and WhatsApp.
6. **Unattended reads.** Does the user's PSD2 consent cover a server reading without the user present, and is one daily read within Enable Banking's terms?
7. **Minimum age.** Is 16 the right threshold, and is a statement enough or is a check required?
8. **Controller entity and DPO.** Which legal entity is the controller, and is a DPO required?

## 10. Proposed text deltas

Consent v3 already implements most of the earlier proposal. These are the remaining edits.

### 1. Account numbers (replace the first sentence of "Wat de server niet bewaart")

> De transacties en saldi van die run blijven alleen in het werkgeheugen en komen niet in de database of in logboeken. Wel bewaren we versleuteld de bankkoppeling: de sessie en de rekeninglijst die je bank terugstuurt, inclusief rekeningnummers, zolang je toestemming bij je bank loopt, tot ten hoogste 181 dagen. De server heeft die nodig om te kunnen lezen.

### 2. Controller (replace the first sentence of "Wie is verantwoordelijk")

> [NOG INVULLEN: bedrijfsnaam, rechtsvorm, KvK-nummer, adres] is verwerkingsverantwoordelijke in de zin van de AVG voor de persoonsgegevens die onze server verwerkt. Contact over privacy: [NOG INVULLEN: privacy-adres].

### 3. Transfers (replace the paragraph under "Doorgifte buiten de Europese Economische Ruimte")

> Enable Banking levert de bankgegevens. Resend (VS) bezorgt e-mail; alle accountgegevens, metadata en logboeken van Resend staan in de VS, ook als e-mail uit de EU wordt verzonden. De pushdienst van je browser (Google, Apple of Mozilla) bezorgt pushmeldingen en ziet het eindpunt, de timing, de omvang en het adres van onze server. Vercel host de app; de functies draaien in Frankfurt (`fra1`). Neon host de database in Frankfurt (`aws-eu-central-1`). Meta bezorgt WhatsApp-berichten. Mistral verwerkt binnen de EU. [NOG INVULLEN: per verwerker of DPF of standaardcontractbepalingen gelden; TypeSafe en PostHog regio.]

### 4. Required data and profiling (add after the lawful-basis table)

> De dagelijkse melding is vrijwillig. LaVega werkt ook zonder. Voor de melding is een bankkoppeling nodig; zonder die koppeling staat de functie uit. De suggestie voor een betere kaart of spaarrente is een berekening op basis van je uitgaven. Er is geen geautomatiseerd besluit met rechtsgevolgen.

### 5. Rights procedure (extend the rights sentence)

> Mail [NOG INVULLEN: privacy-adres] om een van deze rechten uit te oefenen. We antwoorden binnen een maand.

### 6. Login deletion (replace the last sentence of "Jouw controle")

> "Servergegevens verwijderen" verwijdert ook je inlog. Wil je alleen je persoonlijke gegevens wissen en je inlog houden, gebruik dan "Persoonlijke gegevens wissen"; die verwijdert je bankkoppeling, voorkeuren en Instinct-gegevens en laat je account staan.

## 11. Open unknowns

- Whether any processor agreement exists with Resend, Neon, Vercel, Mistral, Meta, PostHog, Sentry, OpenRouter, TypeSafe, Cloudflare, n8n or Enable Banking.
- Which Neon project production links. The only local project named `lavega` is in `aws-eu-central-1`; `.env.local` and `.env.vercel` hold `[SENSITIVE]` placeholders.
- The PostHog and TypeSafe regions (env vars; values not in the repo).
- Mistral's processing location and retention terms. The repo proves only the API URL.
- The exact `accounts` payload Enable Banking returns in production. The adapter expects `account_id.iban`; no live response was inspected.
- Whether any production user is already opted in. The production database is not readable from the repo.
- Vercel runtime-log retention on the current plan.
- That `web-push@4.0.0` encrypts the payload. This is documented library behaviour, not repo code.

No production service was called for this review.

## 12. Evidence log

Read at `f39527e27`:

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
- `packages/database/src/personal-reset.test.ts`
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
