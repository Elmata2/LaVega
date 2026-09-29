import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";

export const dashboard: InvestingDashboardData = {
  ...emptyInvestingDashboard(),
  portfolio: {
    ...emptyInvestingDashboard().portfolio,
    "1M": [
      {
        date: "2026-08-18",
        positionsValue: 100,
        cashValue: 20,
        value: 120,
        unpriced: [],
        forwardFilled: [],
        cashUnknown: [],
      },
    ],
    All: [
      {
        date: "2026-08-18",
        positionsValue: 100,
        cashValue: 20,
        value: 120,
        unpriced: [],
        forwardFilled: [],
        cashUnknown: [],
      },
    ],
  },
  allocation: {
    instrument: {
      buckets: [{ key: "ASML", label: "ASML", value: 120, unpriced: false }],
      unpriced: [],
    },
    entity: {
      buckets: [{ key: "Privé", label: "Privé", value: 120, unpriced: false }],
      unpriced: [],
    },
  },
  positions: [
    {
      symbol: "ASML",
      entity: "personal",
      description: "ASML",
      quantity: 1,
      marketValue: 120,
      portfolioWeight: 1,
      priceStatus: "priced",
      currency: "EUR",
      asOf: "2026-08-18",
      returns: {
        status: "available",
        remainingCostBasis: 100,
        realizedCostBasisRemoved: 0,
        unrealizedGain: 20,
        realizedGain: 0,
        dividendsReceived: 5,
        totalReturn: 25,
        totalReturnPercentage: 0.25,
        sinceFirstBuyPercentage: 0.25,
        firstBuyDate: "2026-01-02",
      },
    },
  ],
  position: {
    symbol: "ASML",
    description: "ASML",
    currency: "EUR",
    priceCurrency: "EUR",
    status: "open",
    quantity: 1,
    currentValue: 120,
    dailyChange: 2,
    dailyChangePercentage: 0.017,
    currentPrice: 120,
    priceStatus: "priced",
    quoteDate: "2026-02-02",
    averageCost: 100,
    returns: {
      status: "available",
      remainingCostBasis: 100,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 20,
      realizedGain: 0,
      dividendsReceived: 5,
      totalReturn: 25,
      totalReturnPercentage: 0.25,
      sinceFirstBuyPercentage: 0.25,
      firstBuyDate: "2026-01-02",
    },
    returnStatus: "available",
    firstBuyDate: "2026-01-02",
    quantityHistory: [{ date: "2026-01-02", quantity: 1, delta: 1, reason: "buy", sourceOrder: 0 }],
    activity: [
      {
        date: "2026-01-02",
        kind: "buy",
        quantity: 1,
        executionPrice: 100,
        amount: 100,
        commission: 0,
        currency: "EUR",
        sourceOrder: 0,
      },
    ],
    points: [{ symbol: "ASML", date: "2026-08-18", close: 120, currency: "EUR", markers: [] }],
  },
};

export const emptyDashboard = emptyInvestingDashboard();
export const portfolioSummary = {
  metrics: {
    dailyVolatility: 0.01,
    annualizedVolatility: 0.1587,
    beta: 1.1,
    alpha: 0.02,
    maxDrawdown: -0.25,
    observationDays: 252,
    excludedIntervals: 0,
    pairedObservationDays: 252,
    startDate: "2025-09-10",
    endDate: "2026-09-10",
  },
  risk: {
    status: "estimate",
    range: "1Y",
    from: "2025-09-10",
    to: "2026-09-10",
    drawdownFrom: null,
    minimumObservations: 60,
    benchmark: null,
    benchmarks: [],
    reasons: [],
    missingHoldings: [],
    missingPrices: [],
    coverage: 1,
    currency: "EUR",
  },
  sectors: [{ sector: "Technology", weight: 1 }],
  topPositions: [{ symbol: "ASML", weight: 1 }],
  composition: { pricedHoldings: 1, missingHoldings: 0, estimatedHoldings: 0 },
};
export const portfolioAgents = [
  {
    id: "warren_buffett",
    displayName: "Warren Buffett",
    description: "Quality business owner",
    investingStyle: "Durable moats, fair price.",
  },
  {
    id: "charlie_munger",
    displayName: "Charlie Munger",
    description: "Quality filter",
    investingStyle: "Invert first.",
  },
  {
    id: "bill_ackman",
    displayName: "Bill Ackman",
    description: "Activist lens",
    investingStyle: "Concentrated brands and catalysts.",
  },
];
export const agentInsight = {
  agentId: "bill_ackman",
  displayName: "Bill Ackman",
  signal: "bullish",
  confidence: 78,
  summary: "ASML is concentrated but priced with clear conviction.",
  reasoning: "Position size and return profile show conviction; catalyst data is absent.",
  insights: ["ASML dominates portfolio risk.", "Missing catalyst data limits confidence."],
  model: "test-model",
  snapshotHash: "hash",
};
export const agentConversation = {
  agentId: "bill_ackman",
  displayName: "Bill Ackman",
  text: "ASML is concentrated but priced with clear conviction.",
  model: "openrouter-test",
  snapshotHash: "snapshot",
  judgment: { signal: "bullish", confidence: 80 },
};

/* Every existing test here predates sign-up and runs against a backend
 * with no DATABASE_URL / BETTER_AUTH_SECRET, exactly like local dev — so
 * RequireAuth's get-session check must see the same 503 apps/server sends
 * in that mode, or these tests would redirect to /sign-in instead of
 * rendering the dashboard. */
export function withAuthUnconfigured(input: RequestInfo | URL, fallback: () => Response): Response {
  if (String(input) === "/api/auth/get-session")
    return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
      status: 503,
    });
  return fallback();
}

export function responseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  return withAuthUnconfigured(input, () => {
    if (url === "/api/investing/health")
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
    if (url === "/api/agents/portfolio")
      return new Response(JSON.stringify({ agents: portfolioAgents }));
    if (url === "/api/agents/portfolio/run" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentInsight }));
    if (url === "/api/agents/portfolio/conversation" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentConversation }));
    if (url === "/api/brokers/sync" && init?.method === "POST")
      return new Response(JSON.stringify({ problems: [] }));
    if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(dashboard));
    if (url.startsWith("/api/investing/summary"))
      return new Response(JSON.stringify(portfolioSummary));
    return new Response(JSON.stringify({}));
  });
}

/* A layout GET this test resolves by hand, instead of `responseFor`'s
 * immediate answer — for watching what the shell renders while that request
 * is still in flight. The layout store sends one GET per app, so a second
 * call here shares the one-shot body and fails loudly. */
export function deferredLayoutFetch(): {
  fetch: () => Promise<Response>;
  resolve: (body: unknown) => void;
} {
  let resolve: (body: unknown) => void = () => {};
  const response = new Promise<Response>((settle) => {
    resolve = (body) => settle(new Response(JSON.stringify(body)));
  });
  return { fetch: () => response, resolve };
}

/* A dashboard GET this test resolves by hand, instead of `responseFor`'s
 * immediate answer — for watching what the page renders while the dashboard
 * is still in flight (e.g. a cold visit to /profile before any data has
 * ever loaded). */
export function deferredDashboardFetch(): {
  fetch: () => Promise<Response>;
  resolve: (body: unknown) => void;
} {
  let resolve: (body: unknown) => void = () => {};
  const response = new Promise<Response>((settle) => {
    resolve = (body) => settle(new Response(JSON.stringify(body)));
  });
  return { fetch: () => response, resolve };
}

export function emptyResponseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  return withAuthUnconfigured(input, () => {
    if (url === "/api/investing/health")
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
    if (url === "/api/agents/portfolio")
      return new Response(JSON.stringify({ agents: portfolioAgents }));
    if (url === "/api/agents/portfolio/run" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentInsight }));
    if (url === "/api/agents/portfolio/conversation" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentConversation }));
    if (url === "/api/brokers/sync" && init?.method === "POST")
      return new Response(JSON.stringify({ problems: [] }));
    if (url.startsWith("/api/investing/dashboard"))
      return new Response(JSON.stringify(emptyDashboard));
    return new Response(JSON.stringify({}));
  });
}

