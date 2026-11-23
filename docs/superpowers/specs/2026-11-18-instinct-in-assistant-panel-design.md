# Instinct messages in the Assistent panel

Date: 18 Nov 2026. Branch: `feat/instinct-in-assistant-panel` (from `origin/master`).
Status: owner asked "integrate the Instinct agent in the sidebar where currently we have the
agent set up". Decision: option A. The daily messages show inside the right-hand Assistent
panel as a short feed above the chat. Settings stay in Profiel.

## 1. Goal

The daily message is visible where the owner already looks: the Assistent panel (column from
1024 px, sheet below). No new view, nothing removed. The Home card, the `meldingen` view and
the settings card stay as they are.

## 2. What the panel shows

A section "Meldingen" / "Messages" (h3 in the panel's heading order), above the chat. Bounded
height with its own scroll, so the chat input stays reachable at 1280 x 720 and in the sheet.

| State                                        | Panel shows                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Not signed in (device vault)                 | nothing, no request                                                                |
| Settings lookup answers 503 (not configured) | nothing, no error                                                                  |
| Agent off                                    | "Je dagelijkse bericht staat uit." + button "Aanzetten in Profiel" (opens Profiel) |
| Agent on, loading                            | nothing (the panel's existing loads are silent too)                                |
| Agent on, no messages                        | "Nog geen berichten. Je krijgt er hooguit één per dag."                            |
| Agent on, messages                           | latest 3, newest first, date + text, link "Alle meldingen" (opens `meldingen`)     |
| Agent on, feed 503 or 401                    | nothing                                                                            |
| Agent on, load failed                        | "Berichten laden lukte niet." + button "Opnieuw" (one refetch)                     |

Rows are the same piece the full view uses (`AgentEventItem`). The panel rows have no delete
button: delete is destructive and the column is narrow; deleting stays in `meldingen`. The feed
model has no read/seen notion, so there is no unread marking.

## 3. Out of scope

Moving settings out of Profiel. Removing the Home card or the `meldingen` view. Polling.
Scrolling to the settings card (the app has no anchor pattern; the button opens Profiel).
Motion: none.

## 4. Data flow

- `useAgentMirror` already looks up `GET /api/agent/settings` once per account. It now also
  returns `status`: `unknown | off | on | unavailable` (503 = `unavailable`). `enabled` is
  unchanged.
- `createFeedStore(api)` (agent/feedStore.ts) holds the first page of the `feed` channel: one
  in-flight request is shared, a result stays fresh for 60 s, a failure is never cached,
  delete and retry force a fresh read. `AgentEventList` (first page of the feed channel only)
  and the panel both read through it. Older pages and the settings list stay direct.
- App makes one store per signed-in account and passes it to the panel and to `AgentFeed`.
  The panel reads it only when `status` is `on`. No store, no request.

## 5. Accessibility

Heading h3 "Meldingen"; the list is a `ul` with a name; the "Alle meldingen" link, the
"Aanzetten in Profiel" button and the retry button have names and are 44 px high. Focus order
is messages then chat. Loading results never move focus. The retry button keeps focus.

## 6. Tests

Panel: latest 3 of 5 newest first plus link; off line plus Profiel button and no feed request;
on and empty; 503 settings and 503 feed show nothing; device-only: no section, no request;
failure line plus one refetch on retry; chat still answers its three skills. Store: one fetch
for panel and `meldingen` view mounted together. Hook: `status` values. Existing AgentFeed
tests stay untouched.

## 7. Open questions

- Should the panel fetch only when it is open (`active`)? The column is mounted while closed,
  so today it fetches at mount for an account with the agent on.

## 8. Changes during build

- Round 1 bounded the list with an inner scroll; round 2 removed it (it cut a row in half).
  Now no inner scroll: each text is clamped to 2 lines (full text in `title`), date on its own
  line, and the third row is hidden by CSS when the viewport is under 700 px high. Measured:
  1280 x 720 shows 3 rows, input bottom at 691 px; 375 x 620 and 1400 x 623 show 2 rows, input
  fully in view.
- English section title is "Alerts" (what the en nav calls `meldingen`); link "All alerts".
- A failed status lookup (401, 500, offline, thrown) is `unknown`, never "off": the panel shows
  nothing; `enabled` stays false; the mirror upload gate is still `ready && enabled`.
- Stale cache: `invalidate()` clears the kept answer and the in-flight request, and tells
  subscribers (the panel re-reads). Every successful event or conversation delete calls
  `onAgentFeedChange` in api.ts, so the "what LaVega keeps" list needs no edit. App also
  invalidates whenever `agent.status` is not `on` (turn-off, and a reset that flips the status).
  A new daily message can stay hidden for up to 60 s; accepted.
- Copy lives in `copy/assistant.ts`, not `copy/instinct.ts` (another branch edits that file).
- Panel prop is `instinct` (status, store, onOpenFeed, onOpenSettings); absent for a device vault.
- Settings lookup default is now `fetchAgentStatus` (503 = `unavailable`); `fetchAgentEnabled` kept.
