# Investor agent source (reference only)

These files are copied from the Python `hedge_fund` project (the fork of `virattt/ai-hedge-fund`). They are reference material for porting, not runtime code. Nothing in LaVega imports them.

| File | What it is |
| --- | --- |
| `munger.py`, `buffett.py`, `graham.py`, `lynch.py`, `druckenmiller.py` | Persona system prompts: the mental models and signal rules per investor. |
| `llm_agent.py` | Shared base class: build snapshot, call LLM, parse JSON, abstain on failure, prompt cache. |
| `fundamental-ls.yaml` | Strategy config that blends the five personas into one long/short pod. |
| `VISION.md` | The source project's vision: an AI hedge fund with a point-in-time pipeline. |

## What LaVega takes

- **Persona mental models.** The prompts are the seed for the chat profiles in #177. They are single-company JSON signal prompts, so the chat profile is a conversational rewrite with the same models.
- **Snapshot then prompt.** Fetch data into one compact, rendered snapshot before the model call. LaVega does this in `prepareCall` for chat.
- **Cache by content hash.** An unchanged snapshot never pays for a second LLM call.
- **Fail loud on data, abstain on LLM.** A broken data fetch is an error, never a silent neutral view.

## What LaVega does not take

- Backtest, paper, and live trading modes, the allocator, the risk model, and execution. LaVega advises on a user's broker portfolio; it does not trade.
- Blind prompts (hiding the ticker and dates). They exist for backtest honesty; a chat about a user's own holdings needs the ticker.
- Long/short blending. LaVega users hold long positions.

## Missing source

`hedge_fund/features/snapshot.py` is not copied yet. It defines which fundamentals the personas see and how `FundamentalsSnapshot.render` formats them. Add it before building the fundamentals brief in #177.

`VISION.md` lost some text when pasted (for example the "Trading desk" table row and the research lab diagram). Replace it with the original file when available.
