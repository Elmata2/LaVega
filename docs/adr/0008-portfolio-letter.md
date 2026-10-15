# Portfolio letter

## Status

Accepted.

## Decision

Charlie Munger writes one letter per broker-sync snapshot. The letter is stored in `investing.portfolio_letters` (migration `0023`), encrypted like agent memory (ADR 0007). Only the broker-sync cron triggers generation. Loading the dashboard reads the stored letter and never calls the model.

## Trigger and gate

After each tenant's broker and price sync, `runInvestingCron` calls `POST /api/letters/ensure`. The route asks the model at most twice — a second attempt only when the first produces nothing — and only when all of these hold:

- No letter exists yet, or holdings changed (a symbol or its quantity), or the latest letter is at least seven days old.
- The snapshot hash differs from the latest letter's. The hash covers quantity, cost basis, realized gain, and dividends per holding, never prices, so a market move alone never triggers a call.

`UNIQUE (user_id, snapshot_hash)` makes two racing calls store one letter. A failed letter call is reported as `letterStatus` and never fails the sync. The existing daily cron is the only scheduler; there is no new schedule.

## Consequences

- The letter asks for a JSON object with `Output.object`, and the provider is created with `supportsStructuredOutputs`, so `response_format: json_schema` reaches the model and the SDK validates the reply. Without that flag the provider drops the schema (the SDK warns `responseFormat ... only supported with structuredOutputs`), the model answers in prose, and the observations arrive as strings that the server must discard.
- The server keeps at most three observations whatever the model returns, because `maxItems` is not a hard bound on every model.
- The call is at most two attempts, each capped at 45 seconds, with no SDK-inner retries. A queued or rate-limited first attempt is abandoned at 45 seconds and started fresh, which is what a fast answer needed in practice. When both attempts fail the previous letter stays in place and the pass reports `letterStatus`; the next sync retries.
- The letter is a snapshot of the portfolio at write time. "Discuss" opens a new Munger thread with the letter as the first message, so the figures the owner sees are the figures Charlie discusses.
- Erase all data and the memory export include letters.
