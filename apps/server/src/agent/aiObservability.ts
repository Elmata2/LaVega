import { PostHog } from "posthog-node";

export type AiObservationContext = {
  distinctId: string;
  sessionId: string;
  traceId: string;
};

type Generation = {
  model: string;
  operation: "chat" | "ocr" | "conversation";
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
};

let client: PostHog | null | undefined;

function posthogClient(): PostHog | null {
  if (client !== undefined) return client;
  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  const host = process.env.POSTHOG_HOST?.trim();
  if (!apiKey || !host) {
    if (process.env.NODE_ENV === "development") {
      const missing = apiKey ? "POSTHOG_HOST" : "POSTHOG_API_KEY";
      throw new Error(
        `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`,
      );
    }
    client = null;
    return client;
  }
  client = new PostHog(apiKey, {
    host,
    privacyMode: true,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });
  return client;
}

/** One user-initiated AI workflow becomes one session and trace. */
export function createAiObservationContext(userId: string | undefined): AiObservationContext | undefined {
  const distinctId = userId?.trim();
  if (!distinctId) return undefined;
  return {
    distinctId,
    sessionId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  };
}

/**
 * The application promises not to retain AI requests. Keep privacy mode on and
 * omit prompt/completion content while preserving model, latency, token, and
 * trace metadata needed for operational AI observability.
 */
export async function captureAiGeneration(
  context: AiObservationContext | undefined,
  generation: Generation,
): Promise<void> {
  if (!context) return;
  const posthog = posthogClient();
  if (!posthog) return;
  try {
    posthog.capture({
      distinctId: context.distinctId,
      event: "$ai_generation",
      properties: {
        $ai_provider: "mistral",
        $ai_model: generation.model,
        $ai_latency: generation.latencyMs / 1000,
        $ai_input_tokens: generation.inputTokens,
        $ai_output_tokens: generation.outputTokens,
        $ai_trace_id: context.traceId,
        posthog_trace_id: context.traceId,
        $ai_session_id: context.sessionId,
        ai_operation: generation.operation,
      },
    });
    await posthog.flush();
  } catch (error) {
    console.error(
      `posthog ai observability: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
