// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

test("overview shell fetches and displays investing server health", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(new Response(JSON.stringify(String(input) === "/health" ? { ok: true, service: "investing-server" } : { accepted: true, disclosure: "Yahoo-melding" })) )));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter><App /></MemoryRouter>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("investing-server: beschikbaar");
  expect(fetch).toHaveBeenCalledWith("/health");
  root.unmount();
});

test("positions route renders its empty state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, service: "investing-server" }))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>);
  });

  expect(container.textContent).toContain("Geen posities geladen");
  expect(container.querySelector('nav[aria-label="Hoofdnavigatie"]')).not.toBeNull();
  root.unmount();
});

test("shows Yahoo disclosure and sends no price sync before acceptance", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { requests.push(String(input)); return new Response(JSON.stringify(String(input) === "/api/market-data/consent" && init?.method === "POST" ? { accepted: true } : { accepted: false, disclosure: "Yahoo-melding" })); }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Yahoo-melding");
  expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("ga akkoord"))).toBe(true);
  expect(requests).toContain("/health");
  expect(requests).toContain("/api/market-data/consent");
  expect(requests).not.toContain("/api/prices/sync");
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("ga akkoord"))!.click(); await Promise.resolve(); });
  expect(requests).toContain("/api/market-data/consent");
  expect(requests.filter((request) => request === "/api/market-data/consent")).toHaveLength(2);
  expect(requests).not.toContain("/api/prices/sync");
  root.unmount();
});

test("shows broker sync problems and asks before deleting cached prices", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    if (String(input) === "/api/brokers/sync") return new Response(JSON.stringify({ problems: ["ibkr: niet beschikbaar"] }));
    if (String(input) === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true, disclosure: "Yahoo-melding" }));
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Synchronisatieproblemen");
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Prijsgegevens wissen"))?.click(); await Promise.resolve(); });
  expect(container.textContent).toContain("Dit verwijdert alle lokaal opgeslagen prijsgegevens.");
  expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("alles verwijderen"));
  await act(async () => { deleteButton?.click(); await Promise.resolve(); });
  expect(requests.some((request) => request.method === "DELETE" && request.url === "/api/prices/cache")).toBe(true);
  root.unmount();
});
