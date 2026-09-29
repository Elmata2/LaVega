# Investor agent source (reference only)

These files are copied unchanged from [`virattt/ai-hedge-fund`](https://github.com/virattt/ai-hedge-fund) at commit `5d2c7ca2` (2026-09-26), under its MIT license (`LICENSE`). They are reference material for porting. Nothing in LaVega imports or runs them. Paths below mirror `hedge_fund/` in the source repo.

## Map

| File                                                                   | What it is                                                                                               | Use in LaVega                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `munger.py`, `buffett.py`, `graham.py`, `lynch.py`, `druckenmiller.py` | Persona system prompts: mental models and signal rules per investor.                                     | Seed for the chat profiles in #177.                      |
| `llm_agent.py`                                                         | Persona base class: build snapshot, call LLM, parse JSON, abstain on LLM failure, prompt cache.          | Pattern for the #177 prefetch and cache.                 |
| `signals/base.py`, `models.py`                                         | `AlphaModel` interface and the `Signal` shape (conviction in [-1, +1], thesis, metadata).                | Shape for typed agent views.                             |
| `features/snapshot.py`, `features/test_snapshot.py`                    | Point-in-time fundamentals snapshot, `render()` for the prompt, `content_hash`.                          | Model for the #177 fundamentals brief.                   |
| `data/models.py`                                                       | Vendor data models: prices, financial metrics, earnings, news, insider trades.                           | Field list for the Yahoo mapping.                        |
| `data/protocol.py`                                                     | `DataClient` protocol that every data source implements.                                                 | Model for the `FundamentalsProvider` seam.               |
| `data/cached.py`                                                       | Disk cache wrapper that knows when a trading day's data is complete.                                     | Freshness rules for the fundamentals cache.              |
| `llm/cache.py`                                                         | Prompt cache keyed on a hash of agent, model, system and user prompt, with an audit record.              | Audit trail for agent answers.                           |
| `llm/watch.py`                                                         | Reads `signal`, `confidence` and `reasoning` out of a JSON stream before it completes.                   | Only if a typed view needs to stream.                    |
| `pipeline/models.py`                                                   | `DecisionRecord` and `CycleRecord`: every signal, weight and clamp of one run, serialized.               | Model for stored letters (#179) and agent memory (#178). |
| `risk/limits.py`                                                       | Hard position and gross caps that log a `ClampEvent` with before, after and reason.                      | Model for explainable concentration insights.            |
| `strategies/*.yaml`                                                    | Configs that blend personas into pods (fundamental long/short, deep value, earnings drift, inflections). | Shows which personas combine.                            |
| `VISION.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `UPSTREAM-README.md`     | Source project vision, roadmap, `hedge_fund/README.md`, and root README.                                 | Principles and planned personas.                         |

## The snapshot the personas see

`features/snapshot.py` is the data contract for every persona prompt.

- Each filed period has 12 metrics: market cap, P/E, ROE, gross margin, operating margin, net margin, debt to equity, current ratio, revenue growth, EPS, book value per share, and free cash flow per share. It also has the report period and filing date.
- The snapshot adds 6 aggregates: average ROE, average net margin, gross margin trend (latest minus oldest), book value per share CAGR, latest debt to equity, and latest market cap.
- It needs at least 4 filed periods (`MIN_PERIODS`). With fewer it raises `InsufficientData` and the agent abstains.
- `content_hash` hashes the snapshot without `as_of`. The agent re-reasons only when a new filing changes the data.
- `render()` prints a short summary block and a history table, newest period first.

The source uses Financial Datasets (`api.financialdatasets.ai`). `docs/investing/STACK.md` rules that vendor out, so LaVega fills the same fields from Yahoo quoteSummary.

## What LaVega takes

- **Persona mental models.** The prompts are single-company JSON signal prompts. The chat profile is a conversational rewrite with the same models.
- **Snapshot before prompt.** Fetch data into one compact rendered snapshot before the model call. LaVega does this in `prepareCall`.
- **Cache by content hash.** An unchanged snapshot never pays for a second LLM call.
- **Fail loud on data, abstain on LLM.** A broken data fetch is an error, never a silent neutral view.
- **Explainable limits.** Every clamp records before, after and why. The advisor can say why a position is too large.

## What LaVega does not take

- Backtest, paper, and live trading, the allocator, portfolio construction, execution, and brokers. LaVega advises on a user's broker portfolio; it does not trade.
- Blind prompts that hide the ticker and dates. They exist for backtest honesty; a chat about the user's own holdings needs the ticker.
- The LLM provider layer (`llm/client.py`, `llm/registry.py`, `llm/contract.py`). LaVega uses the AI SDK with OpenRouter.
- The Financial Datasets client (`data/client.py`), the PEAD quant model, the event study, and the TUI.
