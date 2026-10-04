# Portfolio letter

## Status

Accepted.

## Decision

Charlie Munger writes one letter per broker-sync snapshot. The letter is stored in `investing.portfolio_letters` (migration `0022`), encrypted like agent memory (ADR 0007). Only the broker-sync cron triggers generation. Loading the dashboard reads the stored letter and never calls the model.

## Trigger and gate

After each tenant's broker and price sync, `runInvestingCron` calls `POST /api/letters/ensure`. The route makes at most one model call, and only when all of these hold:

- No letter exists yet, or holdings changed (a symbol or its quantity), or the latest letter is at least seven days old.
- The snapshot hash differs from the latest letter's. The hash covers quantity, cost basis, realized gain, and dividends per holding, never prices, so a market move alone never triggers a call.

`UNIQUE (user_id, snapshot_hash)` makes two racing calls store one letter. A failed letter call is reported as `letterStatus` and never fails the sync. The existing daily cron is the only scheduler; there is no new schedule.

## Consequences

- The server keeps at most three observations whatever the model returns, because a schema bound is only a hint to the model.
- The letter is a snapshot of the portfolio at write time. "Discuss" opens a new Munger thread with the letter as the first message, so the figures the owner sees are the figures Charlie discusses.
- Erase all data and the memory export include letters.
