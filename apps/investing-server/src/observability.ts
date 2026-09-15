export type ProblemContext = {
  source: "broker-sync" | "dashboard-read";
  broker?: string;
  problems: string[];
};

export type ProblemReporter = (context: ProblemContext) => void;

export type SentryClient = {
  captureException(error: Error, context?: { extra?: Record<string, unknown> }): void;
};

// A credential value ends at whitespace or at a structural character of the
// format that carries it: JSON, a query string, or a log line. Quotes are not
// terminators — an unbalanced quote must not leave the credential behind.
const VALUE = String.raw`[^\s,;}&]*`;
const SEPARATOR = String.raw`["']?\s*[:=]\s*`;
const SCHEME = String.raw`(?:bearer|basic|digest|token)`;
// "token" is a scheme only behind an Authorization key. On its own it is an
// ordinary English word, as in "token expired".
const STANDALONE_SCHEME = String.raw`(?:bearer|basic|digest)`;
const CREDENTIAL_KEY = String.raw`api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|client[-_ ]?secret|secret|password|passphrase|credential|session[-_ ]?id|session|cookie|jwt|private[-_ ]?key`;

// An Authorization header must be matched before the generic rule, and must
// consume the scheme together with the credential. Matching the scheme alone
// leaves the credential itself in the output.
const AUTHORIZATION_HEADER = new RegExp(
  String.raw`((?:proxy-)?authorization${SEPARATOR})(["']?)((?:${SCHEME}\s+)?${VALUE})`,
  "gi",
);
const SCHEME_CREDENTIAL = new RegExp(String.raw`\b(${STANDALONE_SCHEME})\s+${VALUE}`, "gi");
const URL_USERINFO = /(:\/\/[^\s/:@]+:)[^\s/@]+@/g;
// A separator is required, so prose such as "token expired" is left alone.
const KEYED_CREDENTIAL = new RegExp(
  String.raw`((?:${CREDENTIAL_KEY})${SEPARATOR})(["']?)${VALUE}`,
  "gi",
);

// An opening quote is restored around the placeholder so that a redacted JSON
// payload still reads as JSON.
const redactValue = (_match: string, key: string, quote: string): string =>
  `${key}${quote}[REDACTED]${quote}`;

export function redactProblem(value: string): string {
  return value
    .replace(URL_USERINFO, "$1[REDACTED]@")
    .replace(AUTHORIZATION_HEADER, redactValue)
    .replace(SCHEME_CREDENTIAL, "$1 [REDACTED]")
    .replace(KEYED_CREDENTIAL, redactValue);
}

export function createProblemReporter(
  input: {
    dsn?: string;
    sentry?: SentryClient;
    write?: (line: string) => void;
  } = {},
): ProblemReporter {
  const write = input.write ?? ((line) => console.log(line));
  return (context) => {
    if (context.problems.length === 0) return;
    const safeContext = {
      event:
        context.source === "broker-sync"
          ? "investing.broker_sync.problems"
          : "investing.dashboard_read.problems",
      source: context.source,
      ...(context.broker ? { broker: redactProblem(context.broker) } : {}),
      problems: context.problems.map(redactProblem),
    };
    const line = JSON.stringify(safeContext);
    write(line);
    if (input.dsn && input.sentry) {
      input.sentry.captureException(new Error("Investing broker sync returned problems"), {
        extra: safeContext,
      });
    }
  };
}
