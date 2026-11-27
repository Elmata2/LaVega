/** Provider-reported usage. `cache*` are prompt-cache counts when the provider
 *  reports them (#300), 0/absent when it does not. */
export type LlmUsage = {
  input: number;
  output: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

/** A function the model may call, in the provider-neutral shape. `parameters` is JSON Schema. */
export type LlmToolSchema = { name: string; description: string; parameters: unknown };

/** One message of a tool-using conversation. `arguments` is the JSON text the
 *  model wrote; the caller parses it. */
export type LlmToolMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: { id: string; name: string; arguments: string }[];
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type LlmToolTurn =
  | {
      type: "tool_calls";
      calls: { id: string; name: string; arguments: string }[];
      usage: LlmUsage;
    }
  | { type: "answer"; text: string; usage: LlmUsage };

export type LlmProvider = {
  complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: LlmUsage }>;
  ocrPdf(input: {
    pdfBase64: string;
    /** Zero-based page indices to process. Omitted means the whole document. */
    pages?: number[];
  }): Promise<{ markdown: string; pages: number }>;
  /** One function-calling turn: the model either asks for tools or answers.
   *  `toolChoice: "none"` withholds the tools for this call. */
  chatWithTools(input: {
    system: string;
    messages: LlmToolMessage[];
    tools: LlmToolSchema[];
    toolChoice: "auto" | "none";
    maxTokens: number;
  }): Promise<LlmToolTurn>;
  chatWithSearch(input: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    onDelta: (text: string) => void;
    /** Hard ceiling on generated tokens. Without one, output length is bounded
     *  only by the model, on the priciest model this app calls. */
    maxTokens: number;
  }): Promise<{
    text: string;
    sources: { url: string; title: string }[];
    usage: LlmUsage;
  }>;
};
