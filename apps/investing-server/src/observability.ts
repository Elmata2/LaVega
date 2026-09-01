export type ProblemContext = {
  source: "broker-sync" | "dashboard-read";
  broker?: string;
  problems: string[];
};

export type ProblemReporter = (context: ProblemContext) => void;

export type SentryClient = {
  captureException(error: Error, context?: { extra?: Record<string, unknown> }): void;
};

const SENSITIVE_VALUE = /((?:api[-_ ]?key|token|secret|password|authorization|credential)["'=:\s]+)([^\s,;}]+)/gi;

export function redactProblem(value: string): string {
  return value
    .replace(SENSITIVE_VALUE, "$1[REDACTED]")
    .replace(/Bearer\s+[^\s,;}]+/gi, "Bearer [REDACTED]");
}

export function createProblemReporter(input: {
  dsn?: string;
  sentry?: SentryClient;
  write?: (line: string) => void;
} = {}): ProblemReporter {
  const write = input.write ?? ((line) => console.log(line));
  return (context) => {
    if (context.problems.length === 0) return;
    const safeContext = {
      event: context.source === "broker-sync" ? "investing.broker_sync.problems" : "investing.dashboard_read.problems",
      source: context.source,
      ...(context.broker ? { broker: context.broker } : {}),
      problems: context.problems.map(redactProblem),
    };
    const line = JSON.stringify(safeContext);
    write(line);
    if (input.dsn && input.sentry) {
      input.sentry.captureException(new Error("Investing broker sync returned problems"), { extra: safeContext });
    }
  };
}
