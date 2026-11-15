import { expect, test, vi } from "vitest";
import { dispatchSseRecord } from "./api.js";

test("a multi-line data record reconstructs the chunk with its newline", () => {
  const onChunk = vi.fn();
  // Claude's writeSSE splits a "regel1\nregel2" chunk into two data: lines.
  dispatchSseRecord("data: regel1\ndata: regel2", { onChunk });
  expect(onChunk).toHaveBeenCalledTimes(1);
  expect(onChunk).toHaveBeenCalledWith("regel1\nregel2");
});

test("a plain data chunk keeps a single leading space of content", () => {
  const onChunk = vi.fn();
  // SSE strips one space after 'data:'; content that itself began with a space
  // arrives as 'data:  wereld' -> " wereld".
  dispatchSseRecord("data:  wereld", { onChunk });
  expect(onChunk).toHaveBeenCalledWith(" wereld");
});
