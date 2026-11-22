import { describe, expect, it, vi } from "vitest";
import {
  looksLikeDocument,
  readerCandidates,
  readThroughReader,
  resolveDocKind,
  nextBreakerState,
  BREAKER_LIMIT,
  firstDocument,
  type BreakerState,
} from "./readerFetch.js";

const page = (extra = "") =>
  `Title: Tarieven\n\nMarkdown Content:\n${"Betalen in vreemde valuta kost 1,5% koersopslag. ".repeat(20)}${extra}`;

describe("looksLikeDocument", () => {
  it("short text is not a document", () => {
    expect(looksLikeDocument("too short").ok).toBe(false);
  });

  it("reader error JSON is not a document", () => {
    const body = JSON.stringify({
      code: 422,
      message: "Target URL returned error " + "x".repeat(500),
    });
    expect(looksLikeDocument(body).ok).toBe(false);
    expect(looksLikeDocument("Error: " + "x".repeat(600)).ok).toBe(false);
  });

  it("captcha page is not a document", () => {
    const text = "Just a moment... " + "lorem ipsum ".repeat(60);
    const r = looksLikeDocument(text);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("a long page that mentions javascript is a document", () => {
    const text = page("Please enable javascript for the best experience. ") + "x ".repeat(2000);
    expect(looksLikeDocument(text).ok).toBe(true);
  });
});

describe("readThroughReader", () => {
  it("requests r.jina.ai/<url> and returns text", async () => {
    const fetchImpl = vi.fn(async () => new Response(page(), { status: 200 }));
    const r = await readThroughReader("https://example.com/fees", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toEqual({ ok: true, text: page() });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://r.jina.ai/https://example.com/fees");
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual([
      "Accept",
      "User-Agent",
    ]);
  });

  it("non-200 returns ok false with the status", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 429 }));
    const r = await readThroughReader("https://example.com/fees", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("429");
  });

  it("timeout returns ok false", async () => {
    const fetchImpl = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "TimeoutError")),
          );
        }),
    );
    const r = await readThroughReader("https://example.com/fees", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/timeout|timed out/i);
  });
});

describe("resolveDocKind", () => {
  it("explicit docKind wins", () => {
    expect(resolveDocKind({ url: "https://a.nl/x.pdf", docKind: "html" })).toBe("html");
    expect(
      resolveDocKind({ url: "https://a.nl/x", docKind: "pdf", contentType: "text/html" }),
    ).toBe("pdf");
  });
  it("missing docKind with .pdf path is pdf", () => {
    expect(resolveDocKind({ url: "https://a.nl/x.PDF?v=2" })).toBe("pdf");
  });
  it("missing docKind with text/html is html", () => {
    expect(
      resolveDocKind({ url: "https://a.nl/rente", contentType: "text/html; charset=utf-8" }),
    ).toBe("html");
    expect(resolveDocKind({ url: "https://a.nl/dl", contentType: "application/pdf" })).toBe("pdf");
    expect(resolveDocKind({ url: "https://a.nl/rente" })).toBe("html");
  });
});

describe("readerCandidates", () => {
  const base = {
    docUrl: null,
    docKind: null,
    docFetch: null,
    termsUrl: "https://a.nl/terms",
    foundUrl: null,
    foundKind: null,
    pdfUrl: "https://a.nl/agreement.pdf",
  };
  it("a pdf that failed plain fetch is offered to the reader", () => {
    expect(readerCandidates(base, new Set(["https://a.nl/agreement.pdf"]))).toEqual([
      "https://a.nl/agreement.pdf",
      "https://a.nl/terms",
    ]);
  });
  it("a pdf that was read is not", () => {
    expect(readerCandidates(base, new Set())).toEqual(["https://a.nl/terms"]);
  });
  it("a docUrl without docKind and no .pdf is html and offered", () => {
    expect(
      readerCandidates({ ...base, pdfUrl: null, docUrl: "https://a.nl/rente" }, new Set()),
    ).toEqual(["https://a.nl/rente", "https://a.nl/terms"]);
  });
  it("document of record comes first: docUrl, pdfUrl, foundUrl, then termsUrl", () => {
    const p = {
      ...base,
      docUrl: "https://a.nl/doc",
      foundUrl: "https://a.nl/found",
      foundKind: "html",
    };
    expect(readerCandidates(p, new Set(["https://a.nl/agreement.pdf"]))).toEqual([
      "https://a.nl/doc",
      "https://a.nl/agreement.pdf",
      "https://a.nl/found",
      "https://a.nl/terms",
    ]);
  });
  it("docFetch jina products get nothing", () => {
    expect(readerCandidates({ ...base, docFetch: "jina" }, new Set())).toEqual([]);
  });
  it("a pdf found url is offered only after plain failure", () => {
    const p = { ...base, pdfUrl: null, foundUrl: "https://a.nl/f.pdf", foundKind: "pdf" };
    expect(readerCandidates(p, new Set())).toEqual(["https://a.nl/terms"]);
    expect(readerCandidates(p, new Set(["https://a.nl/f.pdf"]))).toContain("https://a.nl/f.pdf");
  });
});

describe("looksLikeDocument wrapper warnings", () => {
  const long = "Betalen in vreemde valuta kost 1,5% koersopslag. ".repeat(100);
  it("a reader wrapper with a target-error warning is not a document", () => {
    const text = `Title: x\n\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\n${long}`;
    expect(looksLikeDocument(text).ok).toBe(false);
  });
  it("a not-fully-loaded warning does not reject", () => {
    const text = `Title: x\n\nWarning: This page maybe not yet fully loaded, consider explicitly specify a timer.\n\nMarkdown Content:\n${long}`;
    expect(looksLikeDocument(text).ok).toBe(true);
  });
});

describe("nextBreakerState", () => {
  const run = (outcomes: Parameters<typeof nextBreakerState>[1][]) =>
    outcomes.reduce<BreakerState>((s, o) => nextBreakerState(s, o), {
      consecutive: 0,
      open: false,
    });
  it("five consecutive timeouts open the breaker", () => {
    expect(BREAKER_LIMIT).toBe(5);
    expect(run(Array(4).fill("network")).open).toBe(false);
    expect(run(Array(5).fill("network")).open).toBe(true);
    expect(run(["network", "network", "network", "network", "timeout"]).open).toBe(true);
  });
  it("a success in between resets the count", () => {
    const s = run(["network", "network", "network", "network", "success", "network"]);
    expect(s).toEqual({ consecutive: 1, open: false });
  });
  it("an http error reply does not count", () => {
    const s = run(["network", "network", "http-error", "network", "network", "network"]);
    expect(s.consecutive).toBe(5);
    expect(run(Array(10).fill("http-error")).open).toBe(false);
    expect(run(["network", "not-document"]).consecutive).toBe(1);
  });
  it("an open breaker stays open", () => {
    const s = run([...Array(5).fill("network"), "success"]);
    expect(s.open).toBe(true);
  });
});

describe("firstDocument", () => {
  it("stops after the first candidate that produced a document", async () => {
    const seen: string[] = [];
    const get = async (u: string) => {
      seen.push(u);
      if (u === "a") throw new Error("reader 403");
      return `doc ${u}`;
    };
    const r = await firstDocument(["a", "b", "c"], get);
    expect(r).toEqual({ url: "b", text: "doc b", failures: ["reader 403"] });
    expect(seen).toEqual(["a", "b"]);
  });
  it("returns no document and every failure when none works", async () => {
    const r = await firstDocument(["a", "b"], async () => {
      throw new Error("nope");
    });
    expect(r).toEqual({ url: null, text: null, failures: ["nope", "nope"] });
  });
});
