# Sure teardown: AI assistant, MCP/agent harness, API v1, imports/exports, platform ops

Source: `/tmp/sure`, AGPL-3.0 Rails app ("Sure", community fork of Maybe Finance).
Commit `562fe096d149cb4d1fb1e6d3446527572c1ec7f6` (2026-11-10). Shallow clone; static read only.
All citations are repo-relative under `/tmp/sure` (`path:line`). Docs claims are marked "docs"; code claims were read.

Method: read `docs/CONTEXT.md`, `docs/investing/PORTFOLIO-AGENTS.md`,
`docs/research/2026-10-26-lavega-agent-memory-design.md`, `docs/adr/0007` first; then read Sure
models/controllers/services/jobs/docs and cross-checked the MCP tool inventory against
`app/models/assistant/function/*.rb` (55 files, 8,367 lines). No runtime, no Rails, no bundle.

---

## 0. Verdict and highest-value takeaways

Sure's agent platform is not one feature; it is four separable assets. Ranked by reuse value for LaVega:

| # | Asset | Why it matters | Verdict |
|---|---|---|---|
| 1 | MCP tool contract: one tool registry shared by in-app chat and `/mcp`, JSON Schema definitions, error-as-data, dry-run/write pairs | Exact, tested shape for "agent acts on a finance app". 49 tools; the registry is the single source for both surfaces | **PORT** the transport + registry pattern (S) and the provenance tools (M) |
| 2 | Provenance contract: `record_valuation` citation grammar `(grade: A/B/C)`, statement-coverage statuses, reconcile-vs-ledger report-only | Turns "the model may invent numbers" into a parseable, enforced invariant without giving the model write trust | **PORT** grammar + **ADOPT** coverage/reconciliation (S/M) |
| 3 | Import/export interop: ZIP of CSVs + `all.ndjson`, version marker, portable rules by name/`value_ref`, import readback verification | Directly usable to migrate a past self-hosted Maybe/Sure instance into LaVega; the NDJSON record vocabulary is a ready interop schema | **PORT** subset (M) |
| 4 | AI plumbing patterns: tool-call round cap + forced text on last round, tool-pair-safe history trimming, stable prompt prefix for provider cache, per-operation LLM cost ledger, capability probes | Small, battle-tested details that prevent the expensive failure modes | **ADOPT** (S–M each) |

What does not port: Rails/ActiveRecord, Doorkeeper, Sidekiq capsules, Turbo/Hotwire streaming,
Active Storage authorization, PG-specific SQL. Also skip Sure's dual API envelopes, its single
coarse `read_write` scope, and its "record cost but never enforce a cap" AI usage model.

---

## 1. AI assistant (chat)

### 1.1 Two independent AI pipelines

Sure has two disjoint AI systems sharing only provider credentials (docs
`docs/hosting/ai.md:14-40`): **chat** (per-family backend `builtin` = LLM + function tools,
`external` = remote agent calling back over MCP, `mcp_only` = no in-app chat) and **background
classification** (categorization, merchant detection/enhancement, PDF extraction), which uses the
LLM/Jev provider regardless of chat setting.

`Family::ASSISTANT_TYPES = %w[builtin external mcp_only]` (`app/models/family.rb:38-42`); effective
type is ENV then column then `builtin` (`family.rb:180-188`). `mcp_only` only removes in-app chat;
`/mcp`, OAuth and categorization keep working (`family.rb:38-41`).

### 1.2 Request path and streaming

Browser chat is **not** SSE to the browser; it is a Turbo Stream broadcast from a background job:
`Chat.start!` creates chat + `UserMessage` (`chats_controller.rb:26-30`, `chat.rb:40-48`) →
`after_create_commit` → `Chat#ask_assistant_later` creates a `pending` `AssistantMessage` and
enqueues `AssistantResponseJob` (`user_message.rb:10-12`, `chat.rb:125-130`) → job on
`ai_high_priority` (`assistant_response_job.rb:1-10`) → `Assistant#respond_to` → each appended
chunk is saved and broadcast by the message model (`message.rb:13-16`,
`assistant_message.rb:16-41`).

Two failure-path details worth copying:

- **Watchdog + server-side floor.** Pending bubbles older than `AI_RESPONSE_TIMEOUT` (default 90 s,
  min 30 s) are reclaimed by a client watchdog calling `MessagesController#report_timeout`; the
  server re-reads under lock and refuses (409) if the age floor is not really exceeded
  (`chat.rb:159-233`, `messages_controller.rb:28-45`); a partially streamed turn is demoted to
  `failed`, never resurrected (`chat.rb:211-233`).
- **Streaming whitespace hold.** A whitespace-only first delta is buffered and emitted with the next
  text chunk because blank messages cannot be saved (`responder.rb:80-97`).

### 1.3 Assistant registry and gating

`Assistant.function_classes(user)` is the single tool registry:
35 core tool classes, plus 14 preview tools when `user.preview_features_enabled?`, minus 5
family-config write tools for guests (`app/models/assistant.rb:17-46,66-108`). Therefore:

| Caller | Tool count |
|---|---|
| admin/member, preview on | 49 |
| admin/member, preview off | 35 |
| guest, preview on | 44 |
| guest, preview off | 30 |

MCP uses exactly this registry: `tools/list` maps `Assistant.function_classes(mcp_user)`
(`app/controllers/mcp_controller.rb:85-96`). A tool added to the array is immediately callable by
external agents — the code comments call this out (`assistant.rb:62-65`).

AI gate is per user, not just per instance: `User#ai_enabled? = ai_enabled && ai_available?`, where
`ai_available?` requires the builtin provider to have credentials, or external assistant config +
allow-list (`app/models/user.rb:209-233`). `RequiresAiConsent` redirects chat writes until consent
(`app/controllers/concerns/requires_ai_consent.rb:1-15`).

### 1.4 Prompt design

`Assistant::Configurable` splits the system prompt into:

- a **byte-stable static prefix** (`STATIC_INSTRUCTIONS`, `configurable.rb:12-53`) so providers that
  cache repeated prefixes keep the discount; the comment explains this is the reason
  (`configurable.rb:4-11`);
- a **volatile session context tail**: date, date format, currency formatting, account roster and
  category names (`configurable.rb:115-124`). Rosters collapse to counts above 25 accounts or 60
  categories, or when the context window is small (`configurable.rb:126-182`,
  `app/models/assistant/token_budget.rb:7-25`).

Families may override the static prompt (`Family#ai_prompt(:chat_system)`,
`configurable.rb:109-113`), trading cache discount for customization.

Static rules encode tool discipline: classify request CHAT/LOOKUP/ANALYSIS; never mention tool
names; never repeat an identical failing call; retry once with the corrected arguments given in an
error hint (`configurable.rb:21-45`). Financial-advice guardrails are prompt-level: no buy/sell
recommendations, no assumptions about the user's situation (`configurable.rb:47-52`).

### 1.5 Tool-calling loop (the load-bearing contract)

`Assistant::Responder#respond` (`app/models/assistant/responder.rb:30-72`):

- loop while the provider returns function requests; max **8 rounds** by default, override with
  `ASSISTANT_MAX_TOOL_CALL_ITERATIONS` (`responder.rb:4-8,114-119`);
- parallel function calls in one round count as one round; results are tagged with `:round` and
  replayed in order (`responder.rb:10-17,43-47`);
- on the final permitted round the follow-up request sets `tool_choice: :none` so the model must
  answer in text with what it has instead of raising `ToolCallLimitError` (`responder.rb:53-65`);
- tool definitions stay in the request even on that last round because Anthropic rejects history
  containing tool blocks without tools (`responder.rb:53-58`);
- an empty response (no text, no calls) raises `EmptyResponseError` (`responder.rb:69`).

Tool execution never raises into the turn. `Assistant::FunctionToolCaller#execute` converts failures
into `{error, hint}` data: unknown tool, invalid JSON args, `RecordNotFound` (deliberately
indistinguishable from forbidden, and the SQL message is withheld), date/argument errors, and a
generic "do not retry, answer with what you have" (`app/models/assistant/function_tool_caller.rb:24-73`).

Schema conventions (`app/models/assistant/function.rb`):

- every tool returns `{name, description, params_schema, strict}` (`function.rb:39-46`);
- `build_schema` sets `additionalProperties: false`; strict mode requires all properties listed in
  `required` (`function.rb:30-57`);
- empty enums are pruned to plain strings, because strict providers reject an empty enum
  (`function.rb:60-94`);
- paginated tools clamp `page_size` to 100 and normalize invalid pages to 1 (`function.rb:12,103-115`);
- lists are emitted as compact time series with currency stated once and values rounded to the
  currency precision (`function.rb:125-141`).

Tool descriptions are long-form operating instructions, not one-liners. `get_transactions`
documents the amount-sign convention, `kind` semantics (standard vs funds_movement/cc_payment/
loan_payment/investment_contribution), `clean_name`, `rail`, `operation_date`, and pagination
fields in the description itself (`app/models/assistant/function/get_transactions.rb:11-67`).
This is the most reusable documentation pattern: **the tool contract carries the data semantics**.

### 1.6 Provider abstraction

`Provider::Registry` is a concept-based factory: `exchange_rates`, `securities`, `llm`,
`property_valuations`, `classification` (`app/models/provider/registry.rb:6`). LLM order follows
`Setting.llm_provider`, falling back to whichever provider actually has credentials
(`registry.rb:21-36`). Provider construction reads ENV first, then the `Setting` table
(`registry.rb:82-109`).

`Provider::LlmConcept` is the capability contract (`app/models/provider/llm_concept.rb:1-74`):
`auto_categorize`, `auto_detect_merchants`, `enhance_provider_merchants`, `suggest_bill_setup`,
`process_pdf`, `chat_response`. Chat shapes are generic `Data` types: `ChatMessage`,
`ChatStreamChunk`, `ChatResponse`, `ChatFunctionRequest` (`llm_concept.rb:49-56`), with
`chat_response` taking prompt, model, instructions, functions, function results, tool_choice,
messages, conversation_history, streamer, previous_response_id, session id and a hashed user
identifier (`llm_concept.rb:58-73`).

Providers: OpenAI-compatible (custom base URL supported; hosted-OpenAI detection gates native PDF
and Responses API features, `app/models/provider/openai.rb:20-48`) and native Anthropic
(`app/models/provider/anthropic.rb:1-80`). Both include `LangfuseTraceable` and record usage rows
inside `record_llm_usage`. The history is rebuilt twice for compatibility: an OpenAI-shaped payload
with tool-call/result pairing, and raw message records for Anthropic
(`responder.rb:168-196`).

The **external assistant** streams OpenAI-compatible SSE from a remote agent: bearer token,
`X-Agent-Id`, `X-Session-Key`, 10 s connect / 120 s read, 2 retries before first token, 1 MB SSE
buffer cap; an interruption after streaming started is fatal
(`app/models/assistant/external/client.rb:6-19,36-169`). It forwards the last 20 complete messages
and a hashed family id as `user` (`assistant/external.rb:3,123-127`).

### 1.7 Usage accounting, cost, limits

- `LlmUsage` row: family, provider, model, operation, token counts, cache-write/cache-read tokens,
  `estimated_cost`, metadata (error + HTTP status for failed calls)
  (`app/models/llm_usage.rb:1-11`, `db/schema.rb:1573`). Prices are USD/1M tokens with long-context
  tiers; `calculate_cost` applies Anthropic cache multipliers (1.25× write, 0.1× read) and returns
  `nil` for unknown models (`llm_usage.rb:13-15,207-246`); provider is inferred from model id when
  not passed (`:280-300`).
- Operations recorded: `auto_categorize`, `auto_detect_merchants`, `enhance_provider_merchants`,
  `process_pdf`, `extract_bank_statement`, `suggest_bill_setup`, plus chat via
  `Provider::Openai#record_llm_usage` / Anthropic's equivalent (`openai.rb:846-914`,
  `anthropic.rb:455-500`).
- **No per-family AI quota or budget exists in Sure.** Cost is recorded, never enforced (no
  `AI_DAILY_BUDGET` equivalent). Guards are request timeouts, tool-round cap, per-user `ai_enabled`,
  preview gating, and API-key hourly rate limits (API only).
- `Usage.capture` is daily anonymized PostHog telemetry (HMAC daily id, one claim per day; events
  `web_ui_served_daily`, `ai_assistant_served_daily`, `job_served_daily`, `mcp_call_served_daily`;
  `app/models/usage.rb:1-57`), invoked at `responder.rb:122` and `mcp_controller.rb:113`.
- AI jobs live in a Sidekiq **capsule** with strict queue order (`ai_high_priority` then
  `ai_low_priority`, default 1 thread; `config/sidekiq.yml:1-14`). With one thread,
  `ChatReservation` holds background AI back for 60 s (cap 15 min) while a chat is
  focused/typing/running (`chat_reservation.rb:1-67`, `chat_reservation/fetch.rb:1-27`) — the
  single-thread local-model fairness trick.

### 1.8 AI health and capability probes

`AiHealth` runs bounded, non-destructive probes: LLM liveness, **function calling** (one trivial
tool call, with a tool-less control request distinguishing "tools refused" from "endpoint broken"),
PDF text extraction, PDF vision, vector store, embeddings (`ai_health.rb:5-124`,
`ai_health/probe.rb:11-46,91-219`). Results cache 60 s keyed by component+provider+endpoint+model+
credential hash; failures go to `DebugLogEntry` (`probe.rb:262-287,472-539`). `WorkerAiHealth`
separately records worker-process snapshots (hostname:pid, 5 max, stale after 5 min) because web and
Sidekiq can resolve different config/network (`worker_ai_health.rb:23-133`). Copy the
**function-calling probe** and its `not_configured / not_checked / unsupported / failing` states.

### 1.9 Classification, categorization, enrichment

Two paths behind one call site (`Family::AutoCategorizer`):

- `llm` path (`Provider::LlmConcept#auto_categorize`): batch of up to
  `LLM_MAX_ITEMS_PER_CALL` (ENV > Setting > 25) transactions, returns
  `AutoCategorization(transaction_id, category_name)` (`llm_concept.rb:4-13`).
- `jev` path (`Provider::ClassificationConcept`): typed `decide(state:, questions:)` returning
  `DecisionSet` with per-answer `value` + full `probabilities`, and `CategoryDecision` carrying
  calibrated `confidence` + `usage` (`app/models/provider/classification_concept.rb:1-45`).
  Contract doc: `docs/llm-guides/adding-a-classification-provider.md`.

`Family#resolved_categorization_provider` falls back to the LLM path when Jev is unselected or
unconfigured; credentials alone never select Jev because the choice decides whose transaction text
reaches a third party (`family.rb:190-205`). `CATEGORIZATION_PROVIDERS = %w[llm jev]`
(`family.rb:44-47`).

Apply path (`app/models/family/auto_categorizer.rb`):

- scope only uncategorized, enrichable transactions; skip rows whose `category_id` was **locked**
  and already holds the cached AI value (`auto_categorizer.rb:269-318`);
- low-confidence classification decisions are **withheld**, not applied; only providers reporting
  calibrated confidence are gated (`auto_categorizer.rb:151-171`);
- shadow mode: a configurable share of runs also asks the *other* provider and records agreement
  in `CategorizationComparison`, never applying the shadow answer (`auto_categorizer.rb:173-240`);
- writes go through `transaction.enrich_attribute(:category_id, id, source: "ai")` then
  `lock_attr!(:category_id)` — provenance per attribute (`auto_categorizer.rb:80-89`);
- `DataEnrichment` is polymorphic `{enrichable, attribute_name, value, source}` with source enum
  `ai`, `rule`, `similar`, bank providers, `synth` (`app/models/data_enrichment.rb:1-31`).

The same provenance/lock pattern is what LaVega should adopt for LLM-touched fields.

PDF pipeline: upload creates an `AccountStatement` then a `PdfImport`; `ProcessPdfJob`
(`ai_low_priority`) extracts text/vision via provider, generates import rows, optionally indexes
into the vector store, emails next steps, and leaves statements with rows in `pending` for human
review (`app/jobs/process_pdf_job.rb:1-53`; `app/models/pdf_import.rb:63-84`). Vector search
(`search_family_files`) needs a configured adapter (OpenAI/pgvector/Qdrant); the Statement Vault is
deliberately *not* indexed (`docs/hosting/mcp.md:164-168`).

### 1.10 Chat over API v1

`/api/v1/chats` is an async REST surface for mobile: create chat (optionally seeded with a user
message), list, show with paginated messages, update title, delete; messages are appended to the
same background job that the web path triggers; assistant responses are polled, not streamed
(`app/controllers/api/v1/chats_controller.rb:1-89`,
`app/controllers/api/v1/messages_controller.rb:1-60`, docs `docs/api/chats.md:40-45`). Requires
`ai_enabled` for the calling user (`api/v1/base_controller.rb:346-351`).

---

## 2. MCP server and the wealth agent harness

### 2.1 Protocol, transport, authentication

One endpoint: `POST /mcp` (`config/routes.rb:1067`), JSON-RPC 2.0 over HTTP with MCP Streamable
HTTP conventions (`app/controllers/mcp_controller.rb:1-247`).

| Property | Value (source) |
|---|---|
| Protocol | `2025-06-18`; accepts `2025-03-26` too (`mcp_controller.rb:4-5`) |
| Methods | `initialize`, `tools/list`, `tools/call`; anything else → `-32601` (`:59-69`) |
| Notifications | no `id` → `202 Accepted`, empty body (`:30-35`) |
| Session | server-issued UUID, Rails.cache `mcp:session:<id>` TTL 1 day; header `Mcp-Session-Id` must map to the authenticated user (`:72-83,198-208`); `Mcp-Protocol-Version` echoed (`:244-247`) |
| Auth | `Authorization: Bearer`; first Doorkeeper token requiring scope `read_write` and an active user, then static `MCP_API_TOKEN` constant-time compared + `MCP_USER_EMAIL` lookup (`:127-166`) |
| 401 | sets `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp", scope="read_write"` (`:225-231`) |
| Context | fresh unsaved `Current.session` per request to avoid impersonation bleed (`:168-177`) |
| Errors | JSON-RPC error object; tool exceptions become `{content:[text], isError:true}` with a generic message (no exception text) (`:117-125,233-242`) |
| Tools source | `Assistant.function_classes(mcp_user)` (`:85-96`), scoped lookup on call so hidden tools are not callable by name (`:98-110`) |

OAuth discovery and dynamic client registration:

- `/.well-known/oauth-protected-resource(/*resource_path)` returns resource URL, authorization
  server, `scopes_supported: ["read_write"]`, header bearer (`app/controllers/oauth_metadata_controller.rb:10-20`);
- `/.well-known/oauth-authorization-server` returns authorize/token/registration endpoints,
  `authorization_code` + PKCE `S256`, only `read_write` (`oauth_metadata_controller.rb:22-33`);
- `POST /register` creates a public client with `scopes: "read_write"`; validates redirect URIs
  (forbids script-like schemes, allows native/private-use and loopback), rejects bidi controls and
  confusable "Sure" names (`app/controllers/oauth_registration_controller.rb:1-90`);
- Doorkeeper authorizations controller defaults the scope to `read_write` when the client only has
  that scope (`app/controllers/oauth/authorizations_controller.rb:1-11`); access tokens last 1 year
  (`config/initializers/doorkeeper.rb:107`).
- MCP client/session management UI revokes a user's tokens (`app/controllers/settings/mcp_controller.rb:1-26`).
- Optional Pipelock reverse proxy scans MCP traffic (DLP, prompt injection, tool poisoning,
  signed receipts) — external project, docs `docs/hosting/mcp.md:329-355`.

### 2.2 Complete tool inventory

Every tool is one class in `app/models/assistant/function/`. Names are `self.name`; params are the
top-level properties of `params_schema`. `*` = listed in schema `required:` (verified where marked);
tools not in the array are all-optional. All reads/writes are scoped to the authenticated user's
family and account ACLs.

**Core tools — 35, always in `tools/list` for members**

| Tool | Input params |
|---|---|
| `get_transactions` | `page`, `page_size`, `order`(asc/desc), `sort_by`(date/amount), `search`, `amount`, `amount_operator`(equal/less/greater), `start_date`, `end_date`, `types`(income/expense/transfer), `statuses`, `account_ids`, `accounts`, `categories`, `merchants`, `tags` |
| `get_recurring_transactions` | `status`, `upcoming_within_days` |
| `get_uncategorized_transactions` | `start_date`, `end_date`, `account_ids`, `limit` |
| `get_accounts` | `include_balance_series`, `series_period` |
| `get_holdings` | `page*`, `accounts`, `securities` |
| `get_balance_sheet` | `period`, `start_date`, `end_date`, `interval` |
| `get_income_statement` | `start_date*`, `end_date*`, `account_ids`, `group_by`, `compare_previous_period` |
| `get_budget` | `month`, `prior_months` |
| `get_merchants` | `page`, `page_size`, `search` |
| `get_tags` | `page`, `page_size` |
| `get_categories` | `page`, `page_size` |
| `get_rules` | `rule_id`, `active`, `search`, `page`, `page_size` |
| `get_rule_options` | (none) — returns condition/action types + operators for rule building |
| `get_transfer_match_candidates` | `transaction_id` |
| `search_family_files` | `query*`, `max_results` (vector store; not the Statement Vault) |
| `import_bank_statement` | `pdf_import_id*`, `account_id` |
| `create_goal` | `name`, `target_amount`, `target_date`, `linked_account_names`, `earmarks`, `notes` |
| `create_tag` | `name*`, `color` |
| `update_tag` | `name*`, `new_name`, `color` |
| `create_category` | `name*`, `color`, `icon`, `parent_id` |
| `update_category` | `id*`, `name`, `color`, `icon`, `parent_id` |
| `delete_category` | `id*`, `replacement_id` |
| `create_rule` | `conditions*`, `actions*`, `effective_date`, `name`, `sample_size` |
| `update_rule` | `rule_id`, `name`, `active`, `conditions`, `actions`, `effective_date`, `sample_size` |
| `preview_rule` | `rule_id` or `conditions`+`actions`+`effective_date`, `sample_size` |
| `apply_rule` | `rule_id*`, `preview_token*`, `override_locked` |
| `set_opening_balance` | `account_id`, `balance`, `date`, `dry_run` |
| `update_transaction` | `id*`, `name`, `notes`, `category_id`, `merchant_id`, `tag_ids` |
| `create_transaction` | `account_id*`, `date*`, `amount*`, `name*`, `type`, `currency`, `notes`, `category_id`, `merchant_id`, `tag_ids`, `external_id`, `source`, `user_modified` |
| `delete_transaction` | `id`, `account_id` |
| `match_transfer` | `transaction_id`, `counterpart_transaction_id`, `target_account_id`, `dry_run` |
| `unmatch_transfer` | `transaction_id`, `transfer_id`, `reject`, `dry_run` |
| `review_transfer` | `transfer_id`, `action` |
| `update_transfer` | `transaction_id`, `transfer_id`, `investment_contribution`, `dry_run` |
| `update_budget` | `month`, `budgeted_spending`, `expected_income`, `categories` (each `{category*, amount*}`) |

**Preview tools — 14, only when the MCP user opted into preview features**

Statement Vault tools also require the user to be admin/member, matching the web UI
(`assistant.rb:26-36`; docs `docs/hosting/mcp.md:170-204`).

| Tool | Input params |
|---|---|
| `upload_account_statement` | `filename*`, `content_base64*`, `account_id` (PDF/CSV/XLSX, ≤25 MB; dedup by SHA-256) |
| `list_account_statements` | `account_id`, `review_status`, `content_sha256`, `overlapping_from`, `overlapping_until`, `limit` |
| `get_account_statement` | `statement_id*` (identity + recorded balances + reconciliation; no bytes, no link) |
| `get_statement_coverage` | `account_id*`, `year` |
| `record_valuation` | `account_id*`, `date*`, `amount*`, `source*` (citation grammar) |
| `get_valuations` | `account_id`, `start_date`, `end_date`, `page` |
| `get_insights` | `insight_type`, `include_acknowledged`, `limit` |
| `get_bills` | `status`, `payment_state`, `bill_type`, `search`, `due_within_days` |
| `get_bill_details` | `bill_id*` |
| `get_paycheck_plan` | `periods_limit` |
| `get_bill_audit` | `lookback_months` |
| `create_bill` | `name*`, `amount*`, `first_due_on*`, `frequency`, `is_income`, `bill_type`, `account_name`, `category_name`, `autopay`, `payment_url`, `notes` |
| `update_bill` | `bill_id*`, `name`, `amount`, `account_name`, `category_name`, `bill_type`, `status`, `frequency`, `due_day_of_month`, `weekday`, `month_of_year`, `autopay`, `payment_url`, `notes`, `renews_on`, `trial_ends_on` |
| `record_bill_payment` | `bill_id*`, `occurrence_due_on`, `amount`, `paid_on` |

**Guest delta — 5 core tools removed** for `user.guest?`: `create_tag`, `update_tag`,
`create_category`, `update_category`, `delete_category` (`assistant.rb:38-46,105-107`).

**Doc drift found:** `docs/hosting/mcp.md:134-169` lists 32 core tools; it omits
`get_uncategorized_transactions`, `create_transaction`, `delete_transaction` (all in the code
registry). Treat `tools/list` as truth, as the doc itself says (`mcp.md:136-139`).

### 2.3 Tool contract design patterns worth copying

1. **One registry, two surfaces.** In-app chat and MCP share the function classes; preview/guest
   filtering happens once (`assistant.rb:62-108`). External agents get the same power by design.
2. **Docs in the schema.** Descriptions carry data semantics (sign convention, `kind`, `rail`,
   pagination fields), so an external agent's answers are correct without a second prompt.
3. **Read/write pairing.** `get_valuations` ↔ `record_valuation`; `preview_rule` ↔ `apply_rule`.
   Every destructive-ish write that can be previewed has a dry-run or a token.
4. **Preview tokens as a stale-write guard.** `apply_rule` requires the latest preview token
   (30-minute TTL), refuses if the rule or its matches changed, and `override_locked` is the explicit
   escape for hand-set values (`rule_support.rb:30-33`, `apply_rule.rb:40-58`; `mcp.md:158`).
5. **`dry_run` on reversible structural writes** (`set_opening_balance`, `match_transfer`,
   `unmatch_transfer`, `update_transfer`).
6. **Human sign-off boundaries.** Statement `link`/`reject` are deliberately **not** exposed over
   MCP; the vault suggests an account + confidence and the user confirms
   (`wealth-agent-harness.md:165-172`). `record_valuation` writes the value only with a citation.
7. **No bytes out.** MCP never returns document bytes or links; files are served only to a signed-in
   browser session (`wealth-agent-harness.md:70-92`). Agents get metadata and coverage.
8. **Errors are result data**, not transport failures, with a hint designed to steer one retry
   (`function_tool_caller.rb:24-73`), and a generic message at the MCP boundary so internal SQL or
   storage details never cross the trust boundary (`mcp_controller.rb:117-125`).

### 2.4 Wealth blueprint / agent harness ownership split

Three docs define an external "agent harness" that uses Sure as system of record:
`wealth-agent-harness.md` (the seam), `wealth-blueprint.md` (1,625-line MIT spec, reproduced
verbatim) and `harness-adapters.md`; the blueprint says Sure does not implement the pipeline and
there is no plan to (`wealth-blueprint.md:1-8`).

Two-install shape (`wealth-agent-harness.md:12-36`): the harness repo owns catalogs, tax criteria,
numbered-delta compiler, goldens, workbook; Sure owns accounts/entries/valuations, the Statement
Vault (bytes + SHA-256), coverage and ledger reconciliation.

Ownership table (`wealth-agent-harness.md:38-52`):

| Blueprint layer | Owner | In Sure |
|---|---|---|
| L0/L1 entities, holders | Sure, partially | `Family`, `User`, `accounts.owner_id`; non-user holders (trust, holding company) have no home |
| L1 account registry | Sure | `Account` + `accountable`; off-bank positions as `OtherAsset`/`Property` |
| L1 positions, parameters, FX, tax criteria | Harness | — |
| L2 wealth series | **Sure authoritative** | `Entry`/`Valuation`, `Holding`; harness snapshots to CSV |
| L2 tax series (criterion, applicable, declared, legal_max) | Harness only | "one value, one criterion" has no representation |
| L3 vault — account statements | **Split** | archive, SHA-256 dedup, period detection, matching, review queue; bytes never returned over MCP |
| L3 vault — tax returns, annual accounts, contracts, email | Harness | vault is statement-shaped, PDF/CSV/XLSX only |
| `_control.csv` / reconcile-or-abort | Split | `get_account_statement` reports statement-vs-ledger only (tolerance 0.01, report-only) |
| Gap map / `PENDING` | Sure | `get_statement_coverage` statuses |
| Numbered deltas, goldens, workbook, divergences | Harness only | — |

Three invariants Sure **cannot** provide (`wealth-agent-harness.md:53-68`): **closed periods are
immutable** (a mutable Postgres row keeps no diffable history; immutability lives in harness
commits); **goldens** (pin counts/totals in the harness against snapshots); **reconcile-or-abort as
a hard gate** (Sure's reconciliation is statement-vs-ledger, report-only, fixed 0.01 tolerance; it
does not check parse-integrity of parsed parts vs the document's printed total and never aborts —
both belong to the harness extractor).

Provenance invariants (blueprint §2, `wealth-blueprint.md:130-178`): workbook is a build output,
never source; never invent a datum — every value carries `source: {document}, {date}, {reference}`,
gaps are explicit `PENDING`; reconcile-or-abort; one chosen grain (`account × month ×
asset-class`); tidy long-format data, totals only in views; one value per criterion with
`applicable=true`; closed periods immutable; provenance beats convenience — re-derive from the
original; "the document exists" ≠ "the fact happened"; fail loud with `{file}` + `{field}`.

The machine-enforced piece in Sure is the citation grammar on `record_valuation`
(`app/models/assistant/function/record_valuation.rb:18-51`; docs `wealth-agent-harness.md:138-163`):

```text
source := ["estimated: "] citation [" (grade: A|B|C)"]
A = official document for that exact date; B = derived with a document;
C = proxy/assumption (standing TODO); "estimated: " requires a grade.
```

Rejected: blank citation, `(grade: D)`, capital-`E` `Estimated:`, `estimated:` without grade.
Parsed by `Provenance::Citation.parse!` (`record_valuation.rb:84`); stored appended to the entry's
notes, preserving any human note (`record_valuation.rb:120`). Valid and invalid examples are in
the tool description; the model is told "a value with no provenance is worse than a missing value".

---

## 3. API v1

### 3.1 Surface

`config/routes.rb:808-960` defines `namespace :api, :v1`. The OpenAPI file
`docs/api/openapi.yaml` (11,373 lines) carries **89 paths / 116 operations**, generated by rswag from
request specs (`openapi.yaml:1-16`; docs `docs/api/users.md:5-19`).

Resource groups (all under `/api/v1`):

| Group | Endpoints |
|---|---|
| Read/write financial | `accounts` (index/show), `account_statements` (index/show/create), `balances` (index/show), `budgets`, `budget_categories` (index/show), `categories` (index/show/create), `merchants` (index/show/create), `tags` (full CRUD), `transactions` (full CRUD + nested `split` show/create/update/destroy), `trades` (full CRUD), `holdings` (index/show), `transfers` (index/show), `rejected_transfers` (index/show), `valuations` (index/show/create/update), `recurring_transactions` (full CRUD), `securities` (index/show), `security_prices` (index/show/create), `rules` (index/show), `rule_runs` (index/show) |
| Aggregate views | `balance_sheet`, `cash_flow`, `spending_vs_normal`, `usage`, `family_settings`, `insights` (+`acknowledge`), `provider_connections` |
| Imports/exports | `imports` (index/show/create, `preflight`, `rows`), `import_sessions` (show/create + `chunks` + `publish`), `family_exports` (index/show/create + `download`) |
| Sync | `POST /sync`, `syncs` (index/show + `latest`) |
| Chat | `chats` (index/show/create/update/destroy), nested `messages` create + `retry` |
| Auth/account | `auth/signup|login|refresh|sso_providers|sso_exchange|sso_link|sso_create_account|enable_ai`, `users/reset/status`, `users/reset`, `users/me`, `version` |
| Devices/FinanceKit | `push_subscriptions` create/destroy, `financekit/*` (connections, mappings, activate, credential, repair, conflicts, publisher batches) |

OpenAPI outcome: two capabilities are documented in routes but absent from `openapi.yaml`:
`POST /api/v1/sync` (grep for `"/api/v1/sync"` finds nothing) — verify generated docs before
trusting them. `PATCH /api/v1/auth/enable_ai` is in both (`routes.rb:840`, `openapi.yaml:5767`).

### 3.2 Authentication and authorization

`Api::V1::BaseController` skips session auth and CSRF, forces JSON, then tries in order:

1. **OAuth** — bearer token looked up directly with `Doorkeeper::AccessToken.by_token`, requires
   `read` or `read_write` and an existing active user; sets `@current_user` and a fresh unsaved
   session for `Current` (`api/v1/base_controller.rb:14-106,334-344`).
2. **API key** — `X-Api-Key`, lookup by deterministic-encrypted `display_key`, active check, rate
   limiter (`base_controller.rb:108-127`; `api_key.rb:36-43`).
3. Scopes are hierarchical: `read`/`read_write`; writes need `read_write`
   (`base_controller.rb:196-222`); keys hold exactly one of the two (`api_key.rb:100-107`); guests
   are blocked from family-config writes (`base_controller.rb:225-231`).
4. Cross-family access is checked per resource with `ensure_current_family_access`
   (`base_controller.rb:316-326`).

Auth endpoints bypass the guard to sign up/log in and issue mobile device tokens; signup is atomic
with invite-code claim and device registration (`api/v1/auth_controller.rb:15-80`).
**Gap:** only API-key auth is rate limited; OAuth bearers are not (`base_controller.rb:130-144`).

### 3.3 Rate limits

`ApiRateLimiter` (`app/services/api_rate_limiter.rb:1-102`): hourly Redis buckets per API key
(2 h expiry); tiers standard 100/h, premium 1,000/h, enterprise 10,000/h — **all keys are standard
today**; self-hosted gets `NoopApiRateLimiter` (infinite, `:73-85`); 429 body
`{error:"rate_limit_exceeded", message, details:{limit,current,reset_in_seconds}}` with
`X-RateLimit-Limit|Remaining|Reset` + `Retry-After` headers (`base_controller.rb:146-171`).

### 3.4 Pagination

Three shapes exist, which is a design debt to avoid:

1. **Named collection + `pagination`** (most resources): `{transactions:[...], pagination:{page,
   per_page, total_count, total_pages}}` (`app/views/api/v1/transactions/index.json.jbuilder:1-13`;
   same for accounts/holdings/trades/valuations/transfers/budgets/balances/…).
2. **`{data, meta}`** (newer resources: imports, family_exports, syncs, rule_runs, provider
   connections, account_statements, financekit): e.g.
   `app/views/api/v1/imports/index.json.jbuilder:1-21` with `meta.current_page,next_page,
   prev_page,total_pages,total_count,per_page`.
3. `Pagination` component in OpenAPI is the four-field `{page,per_page,total_count,total_pages}`
   (`openapi.yaml:133-152`); `{data,meta}` collections reuse it for `meta` or declare their own.

Paging params: `page`, `per_page`; API-wide clamp 1..100 (default 25) in
`base_controller.rb:247-254`, but individual controllers also pass Pagy limits (`chats` 20/50,
`insights` no pagination). OpenAPI collections mostly declare `maxItems: 100` or a plain array.

### 3.5 Errors

Shared `ErrorResponse` (`openapi.yaml:344-364`): required `error`, optional `message`, `details`
(array or object), `errors` (array). Runtime handlers (`base_controller.rb:42-45,256-282`):

| Status | `error` | Trigger |
|---|---|---|
| 400 | `bad_request` | missing parameters |
| 401 | `unauthorized` | no/invalid token or key, inactive user, missing scope on OAuth |
| 403 | `forbidden` / `insufficient_scope` / `feature_disabled` | wrong family, missing scope, AI not enabled |
| 404 | `record_not_found` | |
| 422 | `validation_failed` (+ `errors: [message]`) | |
| 429 | `rate_limit_exceeded` (+ `details`) | |
| 500 | `internal_server_error` | per-action rescue in many controllers |

Some controllers deviate with inline `{error: "Failed to create chat", details:[...]}` (e.g.
`api/v1/chats_controller.rb:46,56`) — another drift to not copy.

### 3.6 Versioning, OpenAPI workflow, docs

- Single URL version `v1`, no deprecation policy; `GET /api/v1/version` returns
  `{version, commit_sha}`, auth-gated unless `PUBLIC_VERSION_ENDPOINT=true`
  (`docs/api/version.md:1-30`).
- OpenAPI is generated from executable request specs
  (`RAILS_ENV=test bundle exec rake rswag:specs:swaggerize`); those specs are docs-only while
  behavior lives in Minitest, enforced by a written checklist
  (`docs/llm-guides/api-endpoint-consistency.md:1-56`), plus a source-consistency script
  (`test/support/verify_api_endpoint_consistency.rb`).

---

## 4. Imports, exports, interop

### 4.1 Family export (the migration artifact)

Created by `POST /families/export` web flow / `POST /api/v1/family_exports`, built by
`FamilyDataExportJob` → `Family::DataExporter#generate_export`. Output is a ZIP held in Active
Storage (`app/jobs/family_data_export_job.rb:1-27`, `app/models/family_export.rb:1-81`).

ZIP contents (`app/models/family/data_exporter.rb:12-55`):

| Entry | Shape |
|---|---|
| `version.txt` | `export_version: 2` |
| `accounts.csv` | `id,name,type,subtype,balance,currency,created_at` (`:64-80`) |
| `transactions.csv` | `date,account_name,amount,name,category,tags,notes,currency`; split parents excluded, children exported; tags escaped with backslash (`:6,83-108`) |
| `trades.csv` | `date,account_name,ticker,quantity,price,amount,currency` (`:110-129`) |
| `categories.csv` | `name,color,parent_category,lucide_icon` (`:131-145`) |
| `merchants.csv` | `name,color,website_url` — matches MerchantImport columns for round-trip (`:147-161`) |
| `rules.csv` | `name,resource_type,active,effective_date,conditions,actions,group`; conditions/actions are JSON with IDs resolved to names + `value_ref` (`:163-181,940-946`) |
| `attachments.json` | manifest only: `{version:1, binary_included:false, attachments:[{id,record_type,record_id,name,filename,content_type,byte_size,checksum,binary_included:false,created_at,...}]}` for transaction attachments + family documents (`:183-244`) |
| `all.ndjson` | the canonical record stream, one JSON object per line (`:246-554`) |

`all.ndjson` line shape: `{type, data, version?}`. Types emitted, in order:

`Account` (full `accountable` as_json), `Balance` (all cash/non-cash flow columns), `Category`,
`Tag`, `Merchant`, `ProviderMerchant` (only referenced shared merchants), `RecurringTransaction`
(full bills config: bill_type, amount_strategy/tolerance, notify/overdue windows, match early/late,
renews/trial/cancelled dates, anchor/end modes, weekend/holiday, matcher hints, dedup scope,
replaced_by), `RecurrenceRule`, `RecurringOccurrence`, `RecurringAllocation` (entry carried as
`transaction_id`), `RecurringPriceChange`, `RecurringMatchRejection`, `Transaction` (`id, entry_id,
account_id, date, amount, currency, name, notes, excluded, category_id, merchant_id, tag_ids, kind,
created_at, updated_at` + optional `split_lines[]`), `Transfer` (`{inflow,outflow,status,notes,
investment_contribution}`), `RejectedTransfer`, `Trade` (ticker + name + exchange MIC, qty, price,
amount), `Holding` (qty, price, amount, cost_basis + source/locked flags, security metadata),
`Valuation`, `Budget`, `BudgetCategory`, `Rule` (`version:1`, conditions/actions nested with
`value`+`value_ref`, split config names instead of ids)`.

Portability tricks: rule operands are rewritten to names plus
`value_ref:{type,id,name}` so a different family can re-resolve them (`data_exporter.rb:797-938`);
split-action config rewrites category/merchant/tag ids to names (`:850-869`); binary attachments are
**not** included — a migration must copy documents separately.

### 4.2 Sure import (restore the export)

`SureImport` (`app/models/sure_import.rb`) consumes the `all.ndjson`:

- limits: 10 MB NDJSON, 100,000 rows (ENV `SURE_IMPORT_MAX_NDJSON_SIZE_MB`,
  `SURE_IMPORT_MAX_ROWS`), content types incl. `application/x-ndjson` (`:5-31`);
- importable types map to summary keys (`:7-23`); lines must be `{type, data}` (`:84-96`);
- preflight validates shape/refs before publish (`SureImport::Preflight`, `:223-228,388-394`);
- import delegates to `Family::DataImporter` (1,781 lines) which imports in dependency order:
  accounts → balances → categories → tags → merchants → recurring → transactions → transfers →
  trades → holdings → valuations → budgets → rules, remapping ids (`family/data_importer.rb:1-120`);
- **readback verification**: snapshots family row counts before/after, compares expected counts
  (from line types, with reused-by-name and provider-merchant adjustments), stores
  `readback_verification {status: matched|mismatch|failed|reverted, before/after/actual_delta,
  mismatches}` on the import (`sure_import.rb:292-369`). This is an export→import fidelity check
  LaVega should copy for migrations.
- Reverting a published import deletes its entries; Monarch import additionally restores existing
  accounts it mutated (`app/models/monarch_import.rb:12-16,326-366`).

### 4.3 Actual Budget import

`ActualImport` is a CSV import with fixed default mappings (`app/models/actual_import.rb:4-19`):

```text
signage_convention: inflows_positive
date: "Date" (%Y-%m-%d), name: "Payee", amount: "Amount",
account: "Account", category: "Category", notes: "Notes"
```

Template columns: `Account,Date,Payee,Notes,Category_Group,Category,Amount,Split_Amount,Cleared`
(`:75-83`). `Category_Group` + `Category` are combined as `"Group: Category"` (`:105-113`); blank
Payee falls back to Notes then a default row name (`:99-103`). Imports through the generic CSV
mapping workflow (`:63-73`).

### 4.4 Monarch import

Two CSVs attached to a `MonarchImport` (`app/models/monarch_import.rb:1-60`); parser is
`MonarchImport::Exports`:

- balances CSV required columns: `Date,Balance,Account` (`app/models/monarch_import/exports.rb:5`);
- transactions CSV required columns: `Date,Merchant,Category,Account,Amount,Id`; also reads
  `Original Statement, Notes, Tags, Pending` (`exports.rb:6,62-77`);
- amounts strip `,$`; dates ISO-8601 within `Import.reasonable_date_range` (1970→today+5y);
  BOM stripped; pending included only when opted in (`exports.rb:79-115`; `monarch_import.rb:36-38`);
- per-account suggestion: type from balance sign + transaction presence (mostly-negative + tx →
  CreditCard; negative without tx → Loan; positive + tx → Depository; positive without tx →
  Investment), closed when idle ≥180 days (`exports.rb:121-154`);
- account mapping is per-account user choices (`Import::MonarchAccountMapping`), then
  `MonarchImport::Converter` produces the same `{type,data}` NDJSON records consumed by
  `Family::DataImporter` (`monarch_import.rb:239-259`; converter `monarch_import/converter.rb:1-80`).

Converter semantics worth knowing for a migration: Monarch daily balances become an opening
balance plus `Valuation`s wherever transactions do not explain the balance; an existing account's
opening balance is **moved** to the start of Monarch history and its previous value recorded for
revert; transfer categories `Transfer`→`funds_movement`, `Credit Card Payment`→`cc_payment`;
Monarch transaction id is stored under `extra["monarch"]` (not `external_id`) so a later bank sync
matches rather than duplicates (`converter.rb:13-30`).

### 4.5 Other import formats (for completeness)

`Import::TYPES` also has `TransactionImport` (generic CSV with column mapping and number/date
formats), `TradeImport`, `AccountImport`, `MintImport`, `YnabImport`, `CategoryImport`,
`RuleImport`, `MerchantImport`, `QifImport`, `PdfImport`, `SureImport`, `MonarchImport`
(`app/models/import.rb:42-45`). Import lifecycle statuses: `pending, complete, importing,
reverting, revert_failed, failed`; lost-job thresholds 1 h (manual escape) and 6 h (automatic
reaping) (`import.rb:5-32,94-101`). API import create takes `raw_file_content`/multipart + column
mappings + `publish` (`docs/api/imports.md:61-89`).

### 4.6 Statement Vault pipeline

`AccountStatement` (`app/models/account_statement.rb`):

- **accept**: PDF/CSV/XLSX only, 25 MB, declared type re-sniffed with Marcel, PDF magic checked,
  extension↔content-type consistency (`:20-30,49-63,137-175`);
- **identity**: SHA-256 hex (`content_sha256`) unique per family; Active Storage MD5 kept only to
  catch legacy rows; duplicate upload returns the existing statement, no new row
  (`:52-55,137-155,223-231`);
- **metadata detection** from the document first, filename second: period from dates/month names,
  last-4 from filename, institution/account-name hints; parser confidence tiers 0.85 pdf_text /
  0.65 csv_dates / 0.45 filename / 0.1 none; balances kept only when currency matches
  (`app/models/account_statement/metadata_detector.rb:7-38,47-80,84-150`);
- **account matching** is deterministic hint scoring, no LLM: institution 0.45 + name 0.25 +
  last4 0.25 + currency 0.05; minimum 0.35; refuses to guess on a tie
  (`account_statement/account_matcher.rb:6,31-91`);
- **review queue**: `review_status` `unmatched|linked|rejected`; inbox = account-less unmatched or
  rejected; human link/reject is the only way to attach (`account_statement.rb:41,67-69,248-284`);
- **coverage** is derived, month by month, from statement periods + account activity window:
  `covered, missing, mismatched, ambiguous, duplicate, not_expected`, each with
  `reconciliation_status` (`account_statement/coverage.rb:4-31`; MCP payload described in
  `get_statement_coverage.rb:11-43`);
- **reconciliation** compares user-entered `opening_balance`/`closing_balance` against the ledger's
  `Balance` rows at period start/end and period movement; tolerance 0.01; status
  `matched|mismatched`; `unavailable` when no balances were entered — and nothing extracts them
  from the document (`account_statement.rb:305-348`; docs `wealth-agent-harness.md:145-163,236-246`);
- **authorization**: viewable by shared account users; manageable only by admin/member with
  owner/full-control on the account (`account_statement.rb:234-246`).

MCP wrapper `upload_account_statement` re-validates extension, base64, size, and writable account;
returns `{success, duplicate, statement, message}`; duplicates are reported without disclosing a
statement the user cannot see (`assistant/function/upload_account_statement.rb:64-127`).

### 4.7 Archived export (managed-mode deletion archive)

Before destroying an inactive trial family, managed mode writes the same export ZIP to
`ArchivedExport` with the first user's email; it expires after 90 days and is served unauthenticated
from `/archived_exports/:token` (raw token only in URL; SHA-256 digest stored)
(`inactive_family_cleaner_job.rb:4-63`, `archived_export.rb:1-27`,
`archived_exports_controller.rb:1-16`). Lifecycle pattern, not a separate interop format.

---

## 5. Platform and operations

### 5.1 Deployment mode

`config.app_mode` is `self_hosted` when `SELF_HOSTED=true` or `SELF_HOSTING_ENABLED=true`, else
`managed` (`config/application.rb:40`). It gates: API rate limiting off in self-hosted
(`api_rate_limiter.rb:73-85`); trial cleanup/hosted usage only in managed
(`inactive_family_cleaner_job.rb:8`, `hosted_usage.rb:38-40`); AI availability checks
(`user.rb:209-233`); feature-flag source `db` vs `yaml` (`lib/feature_flags.rb:5-16`); optional
ActiveRecord encryption keys from credentials (`application.rb:42-45`).

### 5.2 Background jobs and cron

Sidekiq has five default queues (`scheduled` 10, `high_priority` 4, `medium_priority` 2,
`low_priority` 1, `default` 1) and an AI capsule (`ai_high_priority` then `ai_low_priority`, strict
order) (`config/sidekiq.yml:1-14`). Scheduled jobs are `ApplicationJob`s in `config/schedule.yml`
with `active_job: true` enforced for a worker-constant-resolution reason (`schedule.yml:1-6`);
crons cover the hourly sync/cleaner, per-connection syncs (15 min), recurring occurrences, insights,
property valuations, session cleanup, debug-log retention, inactive-family cleanup, demo refresh
(`schedule.yml:7-130`).

The **stuck-work reaping pattern** is worth copying: each long-running record type has
`PRESUMED_LOST_AFTER` (manual escape) and `STUCK_AFTER` (automatic), and reaping re-reads under a
row lock before mutating so a finishing job wins (`family_export.rb:1-72`, `import.rb:5-14`,
`pdf_import.rb:18-61`).

### 5.3 Sync architecture

`Family` includes per-provider `*Connectable` concerns (`family.rb:6-19`); a `Sync` row records a
run, provider items enqueue `SyncJob`s with follow-up refresh jobs (Plaid refresh poll, SimpleFIN
apply, SnapTrade activities), and a `SyncSchedule` per connection (cron `SyncScheduledItemsJob`
every 15 min). Pattern: provider item row → sync row with status/error → importer writes entries →
auto transfer matching / categorization chain afterwards; `SyncCleanerJob` reaps stale state. For
LaVega the portable ideas are the statused sync record, per-connection schedules, and follow-up
jobs separated from the initial fetch.

### 5.4 Notifications

Email via ActionMailer (invitations, passwords, PDF next steps, rule notifications); push via
`PushSubscription` (iOS APNs only, sandbox/production, validated hex token, digest of a
per-installation `device_key` to survive user changes) plus `apns` services and
`deliver_insight_notification_job` (`app/models/push_subscription.rb:1-40`, `app/services/apns/`).
Rule email dedup uses a unique `(rule_id, transaction_id)` index with `insert_all ... returning`
so concurrent runs get disjoint sets (`app/models/notification_delivery.rb:1-34`). Insights text is
template-generated, never AI (docs `docs/hosting/ai.md:58-60`).

### 5.5 Feature gating

- **Preview**: single per-user JSONB flag `users.preferences["preview_features_enabled"]`, controller
  concern `PreviewGateable` (`require_preview_features!`), nav helper, DS pill; the family-level
  rollup exists only for jobs and must not gate UI (`family.rb:142-161`;
  `docs/llm-guides/gating-a-preview-feature.md:1-130`).
- **Assistant type** and **categorization provider** are family-level because they decide what data
  reaches a third party (`family.rb:38-48`).
- **Subsystem gates re-checked on the tool path**: bills tools re-check the family recurring gate and
  per-account access on every call because MCP bypasses the Bills controllers
  (`docs/hosting/mcp.md:196-204`).

### 5.6 Multi-tenancy and permissions

- `Family` → `User` (roles `guest, member, admin, super_admin`, `user.rb:63`); financial rows belong
  to a family; API/MCP tools scope through `family.accounts.accessible_by(user)` / `writable_by(user)`.
- Per-account sharing: `AccountShare` permissions `full_control, read_write, read_only`; annotate
  tiers may change entry notes + transaction category/merchant/tags only; validation forbids sharing
  with the owner or across families (`app/models/account_share.rb:1-55`).
- Guests are read-only for family configuration in web, API and MCP registries
  (`assistant.rb:38-46`; `api/v1/base_controller.rb:225-231`).
- API and MCP both build a fresh unsaved `Current.session` instead of reusing a cookie session, to
  stop impersonation state leaking into tool calls (`base_controller.rb:334-344`;
  `mcp_controller.rb:168-177`).

### 5.7 Security posture

- AGPL-3.0 (`LICENSE:1-3`), private disclosure, current release branches only.
- Brakeman on every CI run, importmap audit with retries (`.github/workflows/ci.yml:10-70`); auth via
  session cookies, MFA, passkeys/WebAuthn, OIDC SSO, Doorkeeper OAuth for API/MCP.
- Secrets are ENV > encrypted Settings; endpoint redaction strips userinfo/query/fragment before
  logging (`ai_health.rb:137-151`). Jev must be HTTPS (or loopback http) and is redacted
  (`app/models/provider/jev.rb:57-139`).
- Prompt injection is acknowledged but not solved in-app; recommendation is Pipelock in front of
  `/mcp` (`docs/hosting/mcp.md:314-355`).
- Deliberate information hiding: tool-boundary `RecordNotFound` becomes "no such record, or not one
  you have access to" because the SQL carried the ACL schema (`function_tool_caller.rb:46-58`); MCP
  masks all tool exceptions (`mcp_controller.rb:117-125`).
- `Usage.capture` is opt-outable managed telemetry, off by default outside production
  (`app/models/usage.rb:5-44`).

### 5.8 Testing and CI quality

- 1,219 test/spec files plus `test/architecture`, `test/api_endpoint_consistency_rule_test.rb`, and a
  source-verification script. Two stacks on purpose: Minitest for behavior, RSpec/rswag for OpenAPI
  generation only, with a written rule forbidding assertions in rswag specs
  (`docs/llm-guides/api-endpoint-consistency.md:9-22`).
- CI includes `ci.yml`, `pr.yml`, `llm-evals.yml` (LLM output evaluation is a first-class workflow),
  mobile/desktop/chart/release workflows, and `sync-maybe-sure.yml` (`.github/workflows/`).
- Dense inline comments document the incident or race each non-obvious behaviour guards
  (`chat.rb:159-233`, `api_rate_limiter.rb`, `family_export.rb:1-72`) — review comments survive where
  future agents read them.

---

## 6. Reuse map for LaVega

LaVega current state used for comparison: `apps/server/src/agent/*` (provider, pricing, budget,
rateLimit, redaction, chatContext, facts, prompts, aiObservability),
`apps/investing-server/src/*agent*` (portfolio agent, chat, memory, letters),
`packages/core/src/facts.ts`, ADR 0007. LaVega already has spend pricing, a per-day/month budget gate
with reservations, in-memory rate limiting, redaction, facts, prompt files and thread memory. What it
lacks and Sure proves: a first-class MCP surface, provenance grammar, coverage/reconciliation,
import/export interop, provider capability probing. Effort: S ≈ ≤1 day, M ≈ 2–5 days, L ≈ 1–2 weeks.

| # | Item | Verdict | Effort | Where / shape |
|---|---|---|---|---|
| 1 | MCP endpoint: JSON-RPC `initialize`/`tools/list`/`tools/call`, protocol version negotiation, session id, `202` for notifications, JSON-RPC errors | **PORT** | M | `apps/server/src/mcp.ts` + Hono route `/mcp`. Keep Sure's exact wire behaviour; drop Rails cache → in-memory/file session map or stateless token-only mode |
| 2 | Bearer token auth: static env token + future OAuth. For local-first, start with the static `MCP_API_TOKEN` + user pin; reuse `apiGuard.ts` patterns | **ADOPT** | S | `apps/server/src/apiGuard.ts` extension; document in `docs/` |
| 3 | Shared tool registry for in-app agent and MCP, with per-caller filtering (preview, role) | **PORT** | S | `packages/core/src/agentTools.ts` registry: `{name, description, schema, scope: read|write, preview?: bool, handler}`. Filter once; MCP and chat both consume |
| 4 | Tool semantics in the description (sign convention, `kind`, `rail`, pagination fields) | **PORT** | S | one file per tool group in `apps/server/src/agent/tools/`; descriptions are part of the contract |
| 5 | Error-as-data with `{error, hint}`, retry-once instruction, no SQL/stack text across the boundary | **PORT** | S | tool dispatcher wrapper; test that every tool's thrown error becomes this shape |
| 6 | Loop hardening: round cap (8), forced `tool_choice: none` on last round, pair-safe history trimming, whitespace-hold streaming, demote partial turns to failed | **PORT** | S | LaVega uses AI SDK `ToolLoopAgent` (investing) and a single-turn provider (personal). Add: `stopWhen` step cap + final text instruction; trim by assistant+tool-result pairs; persist partial as failed |
| 7 | Stable prompt prefix + volatile context tail (provider cache discount) | **PORT** | S | `apps/server/src/agent/prompts.ts`: static markdown first, then `TAB-CONTEXT`/session block; keep the fact block and redaction order |
| 8 | Provenance citation grammar `(grade: A/B/C)` + `estimated:` | **PORT** | S | `packages/core/src/provenance.ts`: `parseCitation`, `isEstimated`, `grade`; reused by valuation write + investing thesis/facts. Rejections are tests |
| 9 | Read/write tool pairs and dry-run/preview-token guard for risky writes | **ADOPT** | S | rule/transaction writes: `preview_*` returns token + diff; `apply_*` requires it; 30-min TTL; refuse if target changed |
| 10 | Statement-vault *concepts*: SHA-256 identity, period detection confidence tiers, deterministic hint matching with tie refusal, review queue, month coverage statuses, ledger reconciliation (report-only, 0.01), explicit "unavailable" | **ADOPT CONCEPT** | M | `packages/core/src/statements/` + `packages/adapters` storage. Do **not** copy Active Storage or server-side plaintext bytes: LaVega's vault is encrypted client-side (ADR 0009) |
| 11 | Import/export interop: read Sure ZIP `all.ndjson` (`Account`, `Balance`, `Transaction`, `Trade`, `Holding`, `Valuation`, `Category`, `Tag`, `Merchant`, `Rule`) and Sure `transactions.csv`; emit LaVega's own version marker + NDJSON; verify readback counts | **PORT subset** | M | `packages/core/src/interop/sureExport.ts`; CLI `pnpm lavega import-sure <zip>`. Idempotency: `external_id`/`extra` keys, never rewrite `tx.id` |
| 12 | Actual/Monarch CSV adapters as migration fixtures | **PORT** | S | `packages/adapters/src/import/actual.ts`, `monarch.ts`; treat their exact columns as fixtures (see §4.3–4.4) |
| 13 | Per-operation LLM cost ledger incl. failed calls (0 tokens + error + HTTP status), cache tokens, model→provider inference, long-context tiers | **ADOPT** | S | LaVega `ai_usage` already tracks cost; add `operation` enum + error rows + cache token columns; keep `pricing.ts` as the price source and throw on unknown model |
| 14 | AI health probes: liveness + function-calling probe (with tool-less control request), PDF-extraction probe, bounded timeout, cached results, `not_configured/not_checked/unsupported/failing` states | **ADOPT** | M | `apps/server/src/agent/health.ts` + admin route/CLI; reuse `provider.ts` capabilities |
| 15 | Provider abstraction: capability booleans on the adapter (`supports_model`, `supports_pdf_processing`, `supports_responses_endpoint`) + registry keyed by concept | **ADOPT** | S | extend `apps/server/src/agent/provider.ts`; investing and personal adapters implement the same contract |
| 16 | Categorization provenance and locks: `data_enrichments(attribute,value,source)`, `lock_attr!`, confidence gate only for calibrated providers, shadow comparison | **PORT** | M | `packages/core/src/categorize.ts` + storage; applies to LaVega's categorize/merchant/facts writes |
| 17 | AI consent + per-tenant assistant type/provider selection (family vs instance) | **ADOPT** | S | LaVega local: one profile setting + instance env; hosted: per-tenant. Gate writes at the route |
| 18 | Preview-feature gate for agent capabilities (per-user flag; tools absent from `tools/list` when off; name-guessing also refused) | **ADOPT** | S | reuse for LaVega experimental agent tools; one flag, enforced in registry build + dispatch |
| 19 | API v1 dual auth, hierarchical scopes (`read`/`read_write`), per-resource family check, guest write refusal | **ADOPT CONCEPT** | M | only when hosted tier lands; implement with Effect HTTP + typed errors, not Doorkeeper. One scope pair is enough initially |
| 20 | Consistent API envelope + pagination + error shape; generate OpenAPI from executable tests, not hand-written YAML | **ADOPT** | M | pick `{data, meta}` everywhere; `meta {page,per_page,total_count,total_pages}`; one error schema; OpenAPI generation in CI |
| 21 | Rate-limit headers + 429 shape; hourly buckets keyed per credential | **ADOPT** | S | extend `sharedRateLimit.ts` to emit headers; key by credential; no-op only for genuinely local mode |
| 22 | Stuck-work reaping: presumed-lost vs stuck thresholds, re-read under lock before mutation, automatic + manual escape hatch | **ADOPT** | S | LaVega's agent runs (file store / DB): add thresholds + reaper route/CLI |
| 23 | Manifest-only attachment exports (hashes, sizes, no bytes) + separate document copy | **ADOPT** | S | export must state `binary_included:false` so users know to copy files |
| 24 | Archive-before-delete with expiring tokenized download | **ADOPT CONCEPT** | S | "erase all data" flow: offer a downloadable archive first; store only token digest |
| 25 | Pipelock-style MCP front proxy (DLP, prompt-injection scan, signed receipts) or equivalent local scanning | **ADOPT** | L | out of scope now, but design `/mcp` so a reverse proxy can sit in front (bearer token only, no cookies) |
| 26 | Sidekiq AI capsule, chat reservation, Turbo streaming, Active Storage authorization, Doorkeeper, `has_secure_password`, PostgreSQL RLS | **SKIP** | — | Rails/PG runtime; LaVega has Effect/Hono, encrypted vault, Neon RLS (ADR 0004/0007). Copy the *fairness idea* (single-thread lane) only if LaVega runs a local model |
| 27 | Sure's coarse single `read_write` MCP scope and unthrottled OAuth tokens | **SKIP / do better** | — | Give LaVega agent tokens per-capability scopes and a budget gate before MCP launch |
| 28 | Sure's dual API envelopes and inline error shapes | **SKIP** | — | They are documented debt (§3.4–3.5) |

Sequencing suggestion: 3 → 4 → 5 → 6 (tool loop) → 1 → 2 (MCP) → 8 → 9 (provenance + writes);
10 and 11 are independent tracks for the personal/finance side; 13/14 fit the existing
`apps/server/src/agent` budget/observability work.

---

## 7. Risks and open questions

1. **MCP is write-capable by default with one coarse scope.** `create_transaction`,
   `update_transaction`, `apply_rule`, `update_budget` are reachable with a single `read_write`
   token; no per-tool scope, no write confirmation (`assistant.rb:66-108`,
   `mcp_controller.rb:98-125`). Do better: read tools by default, separate write token, budget gate.
2. **Type drift between the in-app assistant and external docs.** `docs/hosting/mcp.md` omits three
   tools, `docs/api/chats.md` still advertises `gpt-4`/`gpt-3.5-turbo`, and `POST /api/v1/sync` is
   missing from the OpenAPI paths. Generate LaVega contract docs from the registry/tests.
3. **No AI spend enforcement.** Recorded cost only; a leaked or over-broad agent token can spend
   without a cap. LaVega has a budget gate already — wire MCP/chat through it, not around it.
4. **OAuth bearer tokens are not rate limited**, only API keys (`base_controller.rb:130-144`);
   `ApiRateLimiter` standard tier is 100/h for every key, self-hosted unlimited.
5. **MCP tool output is unbounded JSON text.** Descriptions ask the model for small `page_size`
   (`get_transactions.rb:58-66,83-88`) but nothing caps a response; a hostile/curious agent can pull
   large families. Add hard row/byte caps.
6. **Provenance lives in free-text notes.** The citation is appended to `Entry#notes`, so filtering
   by grade means parsing prose. LaVega should store `{source, grade, date, document_id}` as fields
   and still render a human-readable note.
7. **Statement bytes deliberately never leave the server over MCP**; safe, but an external agent
   cannot verify the document itself. LaVega's encrypted vault has the same tension: decide the
   export/parse boundary before building agent tools on the vault.
8. **Reconciliation semantics are weaker than they look.** "Covered" means a document exists; most
   months are `reconciliation_status: unavailable` because balances are user-entered, not extracted
   (`account_statement.rb:305-348`; docs `wealth-agent-harness.md:236-246`). Do not present
   "covered" as "verified".
9. **`get_holdings` requires `page`** (`get_holdings.rb:59-67`) while other list tools default it —
   one pagination convention for LaVega, tested.
10. **Some tool exceptions return `e.message`** (`function_tool_caller.rb:59-65`); the MCP controller
    masks all tool exceptions (`mcp_controller.rb:117-125`) but in-app chat sees the message. Use one
    boundary function that always maps to safe text.
11. **Managed-mode archive stores the first user's email plus a 90-day bearer-token zip**
    (`inactive_family_cleaner_job.rb:42-63`, `archived_export.rb:1-27`). For a privacy-first product,
    archive should be encrypted and user-held, not behind a server token.
12. **License.** Sure is AGPL-3.0 like LaVega, so code reuse is compatible; its blueprint doc is MIT
    and carries its own author — attribute if reused (`wealth-blueprint.md:1-18`).

---

## 8. Verification notes

Read in full or target sections: all files cited above. Not run: Rails, tests, Docker, bundle;
`/tmp/sure` read-only; no network. Unverified / limits: tool schemas are summarised from source
parsing, nested details (e.g. `update_budget.categories`, rule `value_ref` payloads) were read at
top level only — §2.2 is safe at the param-name level, not a full JSON Schema reproduction.
`openapi.yaml` completeness was checked against `config/routes.rb` by path grep, not by booting;
test-env-only routes excluded. Sure's hosted deployment may add limits outside this repo.
`adding-a-securities-provider.md` and `harness-adapters.md` were listed but not analysed.
`Assistant::External` was read from code + docs, not exercised. Minitest vs RSpec split of the 1,219
test files was not counted per stack.

Numbers used: 8,030 tracked files; 1,407 `.rb` files under `app/`; 55 assistant-function files
8,367 lines; 35 core + 14 preview + 5 guest-excluded tools; 89 OpenAPI paths / 116 operations
(11,373-line `openapi.yaml`); 1,219 test/spec files; commit `562fe09`.
