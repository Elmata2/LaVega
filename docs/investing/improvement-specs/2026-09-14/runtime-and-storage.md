# Investing runtime review — master 7a566c4

Static review; findings below are code-confirmed failure paths, not claims of production incidents. Scope: runtime composition, broker sync, storage, price progress. Read docs/CONTEXT.md, investing STACK/CONNECTORS and ADR 0002/0004. Preserve local-first encrypted snapshots and tenant RLS. ADR 0004 is stale (calls runtime persistence/auth deferred although runtime adapters now exist); update its status when implementing these changes.

## R7 — P2: Persist agent run transitions in order

Evidence: `index.ts:658-717` deduplicates identical prompt/persona/model only within process; `:673` discards promise from initial agentRunStore.put(record). Final put is awaited. Default hosted store is Neon (not memory), `neonStores.ts:119-132`, and database `index.ts:484-488` unconditionally upserts latest user row. Default local store is plain JSON `fileAgentRunStore.ts:41-63`.

Failure: slow initial running write can finish after done write and replace completed row with running; rejected detached write is unhandled. Two distinct agent runs overlap and older run finishing last replaces newer run. Shared injected store has no tenant in interface, but production Neon resolves trusted AsyncLocalStorage context; do not claim observed production tenant leak from shared object alone.

Implementation: agent-run module owns start and terminal transition through tenant-bound interface. Await accepted start before model work; terminal write conditional on run id/version still owning latest row. Define latest as latest-started and retain this explicit policy. Use explicit tenant binding when constructing runtime adapters to avoid ambient lookup inside domain operation; injected store must be tenant factory or documented single-tenant-only. No durable background queue or full history feature. Local stored summaries/results can contain exact portfolio facts; protect file using encrypted local vault per privacy constraints, or explicitly approved redacted operational record policy.

Acceptance: controlled delayed start write cannot overwrite done; rejected start prevents model work and reports storage failure; two overlapping runs completing opposite order retain latest-started; tenant A/B interleaving uses isolated records; cold runtime sees persisted terminal result; plaintext local state contains no balances, positions or model reasoning. Dependencies: coordinate parent agent runner/consent spec; use R4 corrected local durability. Deletion test: moving put calls to tiny helper adds no depth; state-transition ownership and storage policy create leverage and locality at run interface seam.

## R1 — P1: Preserve the request deadline through broker orchestration

Status: implemented by Issue #114.

The request route creates one absolute `deadlineMs`. Current-runtime lookup, broker runtime, scheduler, credential-aware adapters, IBKR, Trading 212, and price sync receive that same value. No layer creates a replacement broker deadline. An absent deadline keeps local runs unlimited.

Both brokers reserve five seconds for snapshot and cursor persistence. Trading 212 stops before requests or provider waits that exceed the remaining budget and returns its history cursor. IBKR stops before the statement request, initial wait, each poll request, and each poll sleep. Its adapter converts the stop into a problem result, so orchestration can persist completed broker data and retry IBKR later.

Regression coverage proves real runtime forwarding, scheduler identity propagation, all IBKR stop boundaries, adapter problem conversion, Trading 212 cursor behavior, and unlimited local behavior. No scheduler or queue product was added.

Depth/locality/leverage: budget belongs behind broker sync seam and is not reconstructed in adapters. One request type and one shared persistence-margin helper own the contract.

## R2 — P1: Make broker sync one durable tenant operation

Evidence: `index.ts:128-164` deduplicates via process-local `inFlight`; `index.ts:508-525` reads snapshot, merges, then writes; `neonCredentialStore.ts:83-95` reads each credential row again and writes credentials + snapshot. `packages/database/src/index.ts:132-139` uses unconditional upsert. `packages/adapters/src/brokers/scheduledSync.ts:204-206` saves cursor after callback in separate operations. Broker progress `index.ts:720` combines instance-local status with durable history; only price sync has durable lease implementation.

Failure: cron and browser in different instances both pass lastSyncedAt gate, consume same Trading 212 rate limit, read same snapshot, then stale writer overwrites newer snapshot/cursor. Credential reconnect between snapshot read and repository.put can also be reverted by old credentials embedded in snapshot write. Status request on different instance says idle while sync runs.

Additional merge defect: `index.ts:258-263` permits an authoritative empty positions response to replace old holdings only when trade history is also complete; cash uses same coupling at :285-290. Selling last holding while history pagination is paused therefore leaves old nonzero holdings visible. A nonempty incomplete positions response, conversely, is accepted wholesale. Treat snapshot completeness independently for holdings, cash and each history stream; explicit successful empty holdings must clear old holdings even during paused history, while incomplete holdings must preserve last good records.

Implementation: deep broker-sync module owns claim, progress, snapshot merge, cursor commit and release for tenant/broker. Storage interface: claim lease; read committed snapshot/state; commit result guarded by lease and credential generation; read progress. Neon adapter must update snapshot and sync cursor in one short transaction and must not rewrite credential blob when saving snapshot. Network calls outside transaction. Reject stale lease/generation writes; expired lease permits recovery. Local adapter uses existing encrypted vault, serialized writer and recoverable commit order; do not put plaintext broker data into sync JSON. Preserve ADR 0002 merge rules and cooldown precedence over force. Reconnect increments credential generation and invalidates old cursor so another broker account cannot resume old account history.

Acceptance: two runtime instances sharing test DB start concurrently -> one provider run; expired worker cannot commit; injected commit failure changes neither snapshot nor cursor; reconnect during sync cannot restore old key or old-account snapshot; status from second instance reports running/waiting; tenant A cannot claim/update B. Test actual Postgres transaction/RLS behavior, not only SQL-string mocks. Schema additions require migration. No distributed queue, cron redesign, or new broker. Dependencies: R1 small forwarding fix independent; R2 owns broad scheduler/store edits.

Merge acceptance: existing position A, incoming complete empty positions section, unfinished history -> A removed and history retained; unavailable holdings response cannot remove last-good holding; equivalent cash tests.

Depth/locality/leverage: merge and commit invariants currently cross scheduler, runtime cache and credential adapter seams. Consolidation creates a meaningful operation interface; two real adapters justify seam. Deletion test: remove runtime's read/merge/write callback only after module owns this complexity, not by moving 800-line index wholesale.

## R3 — P1/P2: Price progress must honor durable lease and commit failures

Evidence: `priceOrchestrator.ts:195-197` takeover 30s with checkpoints counted by symbols; `:221-224` suppresses every store.put exception and proceeds, including terminal writes at :392-407. A slow provider call (`:359`) can outlive lease without heartbeat. Error/no-target branches `:251-285` write without a lease, and database `index.ts:374-379` allows those unconditional writes. Shared in-memory adapter `priceOrchestrator.ts:48-50` ignores lease argument entirely.

Failure: storage outage during final write returns completed while DB still running. Another request can take lease during long active fetch. A discovery-failure/no-target caller can overwrite progress held by another worker because those branches precede claim. Five-count checkpoint does not bound elapsed time.

Implementation: price sync module must claim before modifying shared state, including empty/error results. Make lease-aware writes mandatory in both adapters. Propagate durable progress failures as retryable errors; do not claim completion when final commit failed. Use a time-bounded lease renewal policy covering expected provider duration (or bounded provider timeouts and claim validity long enough); recheck ownership before further provider work. Maintain symbol-count batching for cheap cache hits but add elapsed-time bound. Document whether unavoidable in-flight provider completion after lease loss may upsert idempotent price bars; never overwrite new progress.

Acceptance: two orchestrators share store and fake clock; slow target past lease threshold, second run, stale writes rejected. Inject put failure at start/final checkpoint -> no false completion. Discovery failure and empty targets cannot replace another active lease. Same contract suite for memory and Neon; DB test verifies ownership predicate. Dependencies: separate from broker module R2; reuse concepts, avoid generic workflow engine.

Depth/locality/leverage: progress interface should expose safe transitions and ownership, not optional claim plus unguarded put. Deletion test: thin Neon translation adapter has necessary type translation; deleting it only moves mapping, so keep it.

## R4 — P2: Publish local storage state only after successful durable write

Evidence: `jsonFileStore.ts:78-82` assigns cache before writeValue; `fileCredentialStore.ts:114-124` and `:134-135` assign data before encryption/write/rename succeeds.

Failure: disk full, permission error or failed rename makes caller receive rejection, but next read returns uncommitted credentials/prices/snapshot. Later successful update can accidentally persist previously rejected mutation; restart returns different state. Runtime snapshot callback assumes failed persistence leaves last-good state intact, but backing file adapter violates that assumption.

Implementation: calculate next state, encrypt/serialize and atomically rename, then publish in-memory value. Ensure mutation receives copy or is constrained so failure cannot mutate current by reference. Queue complete transition and lock/unlock interaction where required. Preserve existing file formats, 0600 encrypted vault, tmp+rename; no new storage engine or cross-process guarantee for local single-process deployment.

Acceptance: inject write/rename failure, assert rejected operation leaves existing in-memory read and new store reopened from disk identical; subsequent unrelated mutation does not include rejected value; failed first setup stays empty/retryable; concurrent queued successful updates retained. Tests through store interface with filesystem fault injection. Dependencies: independent, but R2 local adapter must use fixed durability behavior.

Depth/locality/leverage: existing file module is already appropriate depth. Strengthen commit invariant, retain adapter seam; deletion would duplicate filesystem complexity across callers.

## R5 — P2: Price target discovery must read current committed broker snapshot

Evidence: `index.ts:729-734` derives targets directly from long-lived brokerData cache. Hosted snapshot refresh lives at `:401-424` and is called only by dashboardReader (`:594-596`). Tenant runtime is retained indefinitely in map (`:740-749`).

Failure: instance A opened before new position exists; instance B syncs new instrument and commits; direct POST prices/sync on warm A still discovers old instruments even after 15-second TTL. No dashboard read means refresh never executes. This can report complete without pricing new holdings.

Implementation: broker snapshot read module owns freshness and version. Expose read for dashboard and price-discovery consumers; refresh committed hosted snapshot before discovery (deduplicate overlapping reads, respect current in-process sync). Keep explicit cached/offline fallback policy: price discovery cannot silently declare fresh completion from failed refresh. Local reads remain memory-backed.

Acceptance: two runtimes over shared storage: A warms, B commits new instrument, clock exceeds TTL, call A prices/sync without dashboard request -> provider sees new symbol. Refresh failure must surface problem rather than false complete; tenants remain separate; concurrent reads deduplicate. Dependencies: R2 may supply snapshot reader; implement within that module if R2 lands first.

Depth/locality/leverage: one read interface owns freshness for both real consumers; remove consumer-specific refresh placement. Deletion test: extracting map getters alone adds no depth; move freshness and version policy together.

## R6 — P2: Reconnect must survive one unreadable broker row

Evidence: `neonCredentialStore.ts:46-55` status catches any row decryption error and returns empty, but `getBrokerData` (:75-80) does not isolate per-broker errors. `index.ts:110` invokes restore callback before writing new credentials in createRuntimeBrokerCredentialSetup; callback calls getBrokerData. When one credential row is unreadable, saving fresh credentials calls setup (no-op) then restore, which throws before replacement. If IBKR is valid and Trading 212 unreadable, initial status returns unlocked then runtime construction reads all rows and fails.

Failure: encryption-key change or malformed old row can prevent dashboard/reconnect from loading, contradicting explicit CONNECTORS.md requirement that unreadable hosted rows remain reconnectable.

Implementation: represent per-broker readability separately from empty/locked. Snapshot load must isolate unreadable rows and expose broker problem; valid broker remains available. Credential save must be permitted before optional snapshot restoration for affected broker, and must not copy unreadable snapshot or suppress general storage outages as empty. No silent cross-account data reuse; replacing credentials follows R2 generation/reset policy.

Acceptance: valid IBKR + undecryptable Trading212 -> dashboard shows IBKR and reconnect state; saving Trading212 key succeeds; both unreadable -> reconnect still works; DB unavailable -> actionable availability error rather than empty vault. Test runtime route composition, not only isolated store.status. Dependencies: coordinate R2 credential-generation work; can implement recovery fix first.
