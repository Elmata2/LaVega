export type LlmProvider = {
  complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens: number;
  }): Promise<{ text: string; usage: { input: number; output: number } }>;
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
    usage: { input: number; output: number };
  }>;
};
