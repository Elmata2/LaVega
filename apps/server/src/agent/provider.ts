export type LlmProvider = {
  complete(input: {
    system: string;
    user: string;
    json?: boolean;
    maxTokens: number;
  }): Promise<{ text: string; usage: { input: number; output: number } }>;
  ocrPdf(input: {
    pdfBase64: string;
    pages?: string;
  }): Promise<{ markdown: string; pages: number }>;
  chatWithSearch(input: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    onDelta: (text: string) => void;
  }): Promise<{
    text: string;
    sources: { url: string; title: string }[];
    usage: { input: number; output: number };
  }>;
};
