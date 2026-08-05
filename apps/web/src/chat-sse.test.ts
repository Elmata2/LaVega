import { expect, test, vi } from "vitest";
import { dispatchSseRecord } from "./api.js";

test("a multi-line data record reconstructs the chunk with its newline", () => {
  const onChunk = vi.fn();
  // Claude's writeSSE splits a "regel1\nregel2" chunk into two data: lines.
  dispatchSseRecord("data: regel1\ndata: regel2", { onChunk });
  expect(onChunk).toHaveBeenCalledTimes(1);
  expect(onChunk).toHaveBeenCalledWith("regel1\nregel2");
});

test("event: error / done route to their handlers, never to onChunk", () => {
  const onChunk = vi.fn();
  const onError = vi.fn();
  const onDone = vi.fn();
  dispatchSseRecord("event: error\ndata: kapot", { onChunk, onError, onDone });
  expect(onError).toHaveBeenCalledWith("kapot");
  dispatchSseRecord("event: done\ndata: ", { onChunk, onError, onDone });
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(onChunk).not.toHaveBeenCalled();
});

test("a plain data chunk keeps a single leading space of content", () => {
  const onChunk = vi.fn();
  // SSE strips one space after 'data:'; content that itself began with a space
  // arrives as 'data:  wereld' -> " wereld".
  dispatchSseRecord("data:  wereld", { onChunk });
  expect(onChunk).toHaveBeenCalledWith(" wereld");
});
