import { useChat, type Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AgentMessageText } from "./AgentMessageText.js";
import {
  createStockResearchChat,
  researchAmount,
  researchErrorMessage,
  researchPercent,
  researchStock,
  type StockJudgment,
  type StockResearchResult,
} from "../lib/stockResearch.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Input } from "./ui/input.js";

const LENSES: Record<string, string> = {
  warren_buffett: "Business quality & lasting value",
  charlie_munger: "Quality, incentives & failure risk",
  bill_ackman: "Cash generation & value unlock",
  ben_graham: "Value & margin of safety",
  peter_lynch: "Growth at a reasonable price",
  stanley_druckenmiller: "Growth, momentum & macro risks",
};

function signalLabel(signal: StockJudgment["signal"]) {
  return signal === "no_view" ? "No view" : signal[0]!.toUpperCase() + signal.slice(1);
}

function ResearchConversation({
  chat,
  judgment,
  expired,
  onRefresh,
}: {
  chat: Chat<UIMessage>;
  judgment: StockJudgment;
  expired: boolean;
  onRefresh: () => void;
}) {
  const { messages, sendMessage, status, error, stop, regenerate, clearError } = useChat({ chat });
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const sending = status === "submitted" || status === "streaming";
  const errorText = error ? researchErrorMessage(error) : null;
  const historyFull = Boolean(errorText?.match(/1–40 messages|30,000 character limit/i));
  const needsRefresh =
    expired || historyFull || Boolean(errorText?.match(/expir|refresh|rerun|re-run/i));
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, status]);

  return (
    <div className="flex min-h-[380px] flex-col">
      <div className="border-b border-border pb-4">
        <h2 className="font-display text-2xl font-semibold">Talk with {judgment.displayName}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{judgment.reasoning}</p>
      </div>
      <div
        className="max-h-[520px] flex-1 space-y-4 overflow-y-auto py-5"
        aria-label={`${judgment.displayName} conversation`}
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask about valuation, business quality, risks, or what could change this view.
          </p>
        )}
        {messages.map((message) => {
          const text = message.parts
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("");
          return text ? (
            <div
              key={message.id}
              className={message.role === "user" ? "ml-8 rounded-tile bg-secondary p-4" : "mr-4"}
            >
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                {message.role === "user" ? "You" : judgment.displayName}
              </p>
              {message.role === "user" ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-7">{text}</p>
              ) : (
                <div className="text-sm leading-7">
                  <AgentMessageText text={text} />
                </div>
              )}
            </div>
          ) : null;
        })}
        {sending && (
          <p role="status" className="text-sm text-muted-foreground">
            {status === "streaming" ? "Replying…" : "Reading company facts…"}
          </p>
        )}
        <div ref={end} />
      </div>
      {errorText && (
        <p role="alert" className="mb-3 text-sm text-negative">
          {errorText}
        </p>
      )}
      {needsRefresh ? (
        <div className="rounded-tile border border-border bg-secondary/40 p-4">
          <p className="mb-3 text-sm">
            {historyFull ? "Conversation limit reached." : "Research snapshot expired."} Run
            research again for current facts and new conversations.
          </p>
          <Button onClick={onRefresh}>Refresh research</Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!input.trim() || sending) return;
            const text = input.trim();
            setInput("");
            clearError();
            void sendMessage({ text });
          }}
        >
          <Input
            aria-label={`Question for ${judgment.displayName}`}
            placeholder="What would change your view?"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={sending}
          />
          {sending ? (
            <Button type="button" variant="outline" onClick={() => void stop()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>
              Send
            </Button>
          )}
        </form>
      )}
      {error && !needsRefresh && (
        <Button
          variant="ghost"
          className="mt-2 self-start"
          disabled={sending}
          onClick={() => {
            clearError();
            void regenerate();
          }}
        >
          Retry reply
        </Button>
      )}
    </div>
  );
}

export function StockResearch() {
  const [symbol, setSymbol] = useState("AAPL");
  const [result, setResult] = useState<StockResearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chats, setChats] = useState(new Map<string, Chat<UIMessage>>());
  const activeChats = useRef(new Map<string, Chat<UIMessage>>());
  const runId = useRef(0);

  useEffect(() => {
    const registry = activeChats.current;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(timer);
      runId.current += 1;
      for (const chat of registry.values()) void chat.stop();
    };
  }, []);

  async function run(ticker: string) {
    if (pending) return;
    const id = ++runId.current;
    setPending(true);
    setError(null);
    try {
      const next = await researchStock(ticker);
      if (id !== runId.current) return;
      for (const chat of activeChats.current.values()) void chat.stop();
      activeChats.current.clear();
      const nextChats = new Map(
        next.report.judgments.map((item) => [
          item.agentId,
          createStockResearchChat(next.reportToken, item.agentId),
        ]),
      );
      for (const [agentId, chat] of nextChats) activeChats.current.set(agentId, chat);
      setChats(nextChats);
      setSelected(null);
      setResult(next);
      setSymbol(next.report.symbol);
      setNow(Date.now());
    } catch (failure) {
      if (id === runId.current)
        setError(failure instanceof Error ? failure.message : "Stock research failed.");
    } finally {
      if (id === runId.current) setPending(false);
    }
  }

  const report = result?.report;
  const company = report?.company;
  const snapshot = company?.snapshot;
  const judgment = report?.judgments.find((item) => item.agentId === selected);
  const expired = report ? Date.parse(report.expiresAt) <= now : false;
  const metrics =
    company && snapshot
      ? [
          ["Share price", researchAmount(snapshot.price, company.priceCurrency)],
          [
            "Forward P/E",
            snapshot.forwardPe === null ? "Unavailable" : `${snapshot.forwardPe.toFixed(1)}×`,
          ],
          ["Return on equity", researchPercent(snapshot.returnOnEquity)],
          ["Net profit margin", researchPercent(snapshot.profitMargin)],
          ["Revenue growth", researchPercent(snapshot.revenueGrowth)],
          ["Earnings growth", researchPercent(snapshot.earningsGrowth)],
          ["Free cash flow", researchAmount(snapshot.freeCashFlow, company.currency, true)],
          ["Market cap", researchAmount(snapshot.marketCap, company.priceCurrency, true)],
        ]
      : [];

  const chat = judgment ? chats.get(judgment.agentId) : undefined;

  return (
    <section className="space-y-5">
      <Link to="/agents" className="text-sm font-semibold text-primary">
        ← All agents
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Research Stock
          </p>
          <h1 className="mt-1 font-display text-4xl font-semibold">
            One company. Six perspectives.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Compare company facts through all six investing philosophies. Select a view to ask
            deeper questions.
          </p>
        </div>
        <form
          className="flex w-full items-end gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            void run(symbol);
          }}
        >
          <label className="min-w-0 flex-1 text-xs font-semibold sm:w-40">
            Stock ticker
            <Input
              className="mt-2"
              value={symbol}
              placeholder="AAPL"
              onChange={(event) => setSymbol(event.target.value)}
              disabled={pending}
              required
              maxLength={24}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </label>
          <Button type="submit" disabled={pending || !symbol.trim()}>
            {pending ? "Researching…" : "Research stock"}
          </Button>
        </form>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-tile border border-negative/30 bg-negative/5 p-4 text-sm text-negative"
        >
          {error}
        </div>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Fetching company facts and six investor views. This can take a moment.
        </p>
      )}
      {!report && !pending && (
        <Card variant="empty">
          <CardHeader>
            <CardTitle>Start with a ticker</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              Try AAPL for Apple. Research includes valuation, profitability, growth and cash flow,
              followed by six independent views.
            </p>
          </CardContent>
        </Card>
      )}
      {report && company && (
        <div
          className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
          aria-busy={pending}
        >
          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-primary">{company.providerSymbol}</p>
                  <CardTitle as="h2" className="mt-1">
                    {company.name ?? report.symbol}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[company.sector, company.industry].filter(Boolean).join(" · ") ||
                      "Industry unavailable"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void run(report.symbol)}
                >
                  Refresh research
                </Button>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Yahoo Finance · Facts fetched {new Date(company.fetchedAt).toLocaleString()}.{" "}
                {expired ? "Research snapshot expired." : "Conversations use this same snapshot."}
              </p>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-border py-5 sm:grid-cols-4">
                {metrics.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Growth compares the latest quarter with a year earlier. Missing figures are
                unavailable. Price and cash flow can use different currencies.
              </p>
              {judgment && chat ? (
                <div className="mt-5">
                  <Button
                    className="mb-4"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(null)}
                  >
                    ← Company overview
                  </Button>
                  <ResearchConversation
                    key={`${result!.reportToken}-${judgment.agentId}`}
                    chat={chat}
                    judgment={judgment}
                    expired={expired}
                    onRefresh={() => void run(report.symbol)}
                  />
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <h2 className="font-display text-2xl font-semibold">Company overview</h2>
                  <p className="text-sm leading-7">
                    {company.name ?? report.symbol} has a forward P/E of{" "}
                    {snapshot!.forwardPe === null
                      ? "unavailable"
                      : `${snapshot!.forwardPe.toFixed(1)}×`}
                    , return on equity of {researchPercent(snapshot!.returnOnEquity).toLowerCase()},
                    and net profit margin of {researchPercent(snapshot!.profitMargin).toLowerCase()}
                    . Free cash flow is{" "}
                    {researchAmount(snapshot!.freeCashFlow, company.currency, true)}.
                  </p>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {company.annual.length} annual periods and {company.quarterly.length} recent
                    quarters support these views. Select an investor to explore its reasoning and
                    ask what could change its conclusion.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <aside aria-label="Six investor views" className="space-y-3">
            <div>
              <h2 className="font-display text-2xl font-semibold">Investor views</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Bullish probability classifies evidence. It does not predict future returns.
                Confidence measures the selected view.
              </p>
            </div>
            {report.judgments.map((item) => (
              <button
                type="button"
                key={item.agentId}
                onClick={() => setSelected(item.agentId)}
                disabled={pending}
                aria-pressed={selected === item.agentId}
                className={`pressable w-full rounded-card border bg-card p-4 text-left disabled:opacity-50 ${selected === item.agentId ? "border-primary ring-1 ring-primary" : "border-border hover:bg-secondary/40"}`}
              >
                <span className="block font-display text-xl font-semibold">{item.displayName}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {LENSES[item.agentId]}
                </span>
                <span
                  className={`mt-3 block text-sm font-semibold ${item.signal === "bullish" ? "text-positive" : item.signal === "bearish" ? "text-negative" : "text-muted-foreground"}`}
                >
                  {signalLabel(item.signal)}
                  {item.signal !== "no_view"
                    ? ` · ${Math.round(item.confidence)}% confidence`
                    : " · Insufficient evidence"}
                </span>
                {item.signal !== "no_view" && item.bullishProbability !== null && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Bullish probability {Math.round(item.bullishProbability)}%
                  </span>
                )}
                {item.signal !== "no_view" && item.conviction !== null && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Evidence strength {Math.round(item.conviction)} / 100
                  </span>
                )}
                <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                  {item.reasoning}
                </span>
                <span className="mt-3 block text-xs font-semibold text-primary">
                  Explore this view →
                </span>
              </button>
            ))}
          </aside>
        </div>
      )}
      <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
        Educational analysis from approximations of public investment philosophies. These are not
        the real investors. Opinions depend on available evidence and are not personal investment
        advice.
      </p>
    </section>
  );
}
