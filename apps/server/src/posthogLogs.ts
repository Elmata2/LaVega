import { type Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

type Env = Record<string, string | undefined>;
type LogAttributes = Record<string, string | number | boolean | undefined>;

let logger: Logger | undefined;

/**
 * Configures a provider used solely by this module's purpose-written records.
 * Existing application console and Sentry logs deliberately remain local.
 */
export function initPosthogLogs(env: Env = process.env): boolean {
  if (logger) return true;

  const apiKey = env.POSTHOG_API_KEY?.trim();
  const host = env.POSTHOG_HOST?.trim();
  if (!apiKey || !host) {
    if (env.NODE_ENV === "development") {
      const missing = apiKey ? "POSTHOG_HOST" : "POSTHOG_API_KEY";
      throw new Error(
        `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`,
      );
    }
    return false;
  }

  const exporter = new OTLPLogExporter({
    url: `${host.replace(/\/$/, "")}/i/v1/logs`,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "lavega-server",
      "deployment.environment": env.VERCEL_ENV ?? env.NODE_ENV ?? "unknown",
    }),
    processors: [new BatchLogRecordProcessor({ exporter })],
  });

  logger = provider.getLogger("lavega-posthog-logs");
  return true;
}

export function logPosthogInfo(body: string, attributes: LogAttributes): void {
  logger?.emit({ severityText: "INFO", body, attributes });
}

export function logPosthogError(body: string, attributes: LogAttributes): void {
  logger?.emit({ severityText: "ERROR", body, attributes });
}
