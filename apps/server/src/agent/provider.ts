/** Provider-reported usage. `cache*` are prompt-cache counts when the provider
 *  reports them (#300), 0/absent when it does not. */
export type LlmUsage = {
  input: number;
  output: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

export type LlmProvider = {
  complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens: number;
  }): Promise<{ text: string; usage: LlmUsage }>;
  ocrPdf(input: {
    pdfBase64: string;
    /** Zero-based page indices to process. Omitted means the whole document. */
    pages?: number[];
  }): Promise<{ markdown: string; pages: number }>;
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
