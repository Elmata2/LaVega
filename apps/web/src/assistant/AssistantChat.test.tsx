// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { emptyAssistantState, syntheticChatVault } from "@lavega/core";
import { assistantCopy } from "../copy/assistant.js";
import { AssistantPanel } from "./AssistantPanel.js";

/* The Assistent chat in the panel: the three states (device vault / no AI service /
 * not opted in), the opt-in card, a conversation with a step label, the errors and
 * the switch-off. `fetch` is a router: every request to the assistant route is
 * recorded, so "nothing is sent before the owner accepts" is asserted on it. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => localStorage.clear());
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  document.cookie = "lavega_locale=; max-age=0; path=/";
});

const vault = syntheticChatVault();
const storage = {
  getAccounts: async () => vault.accounts,
  getTxs: async () => vault.txs,
  getRules: async () => vault.rules,
  getBills: async () => vault.bills,
  getBillOccurrences: async () => vault.occurrences,
  getScheduledFlows: async () => vault.flows,
  getAssistant: async () => emptyAssistantState(),
  putAssistant: async () => undefined,
} as unknown as VaultStorage;

type Router = {
  configured?: boolean;
  assistant?: (
    body: { messages: { role: string; content: string }[] },
    n: number,
  ) => Response | Promise<Response>;
};

function stubNetwork(router: Router = {}) {
  const assistantBodies: {
    locale: string;
    noTools: boolean;
    messages: { role: string; content: string }[];
  }[] = [];
  const all: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    all.push(String(url));
    if (String(url).endsWith("/api/agent/status"))
      return new Response(JSON.stringify({ configured: router.configured ?? true }), {
        status: 200,
      });
    if (String(url).endsWith("/api/agent/assistant")) {
      const body = JSON.parse(init!.body as string);
      assistantBodies.push(body);
      return router.assistant
        ? router.assistant(body, assistantBodies.length)
        : new Response(JSON.stringify({ type: "answer", text: "Antwoord." }), { status: 200 });
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { assistantBodies, all, fetchMock };
}

const answer = (text: string) =>
  new Response(JSON.stringify({ type: "answer", text }), { status: 200 });
const toolCalls = (...calls: { id: string; name: string; args: Record<string, unknown> }[]) =>
  new Response(JSON.stringify({ type: "tool_calls", calls }), { status: 200 });

async function mount(
  props: Partial<React.ComponentProps<typeof AssistantPanel>> = {},
  locale = "nl",
) {
  document.cookie = `lavega_locale=${locale}; path=/`;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AssistantPanel storage={storage} asOf="2026-11-18" {...props} />);
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

const lists = {
  accounts: vault.accounts,
  txs: vault.txs,
  flows: vault.flows,
  bills: vault.bills,
  occurrences: vault.occurrences,
  scope: "persoonlijk",
};
const withChat = { chat: { plan: null, accountId: "u1", ...lists } };

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function ask(view: HTMLElement, text: string) {
  setValue(view.querySelector<HTMLInputElement>("#assistant-input")!, text);
  await act(async () => {
    view
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const button = (view: HTMLElement, label: string) =>
  Array.from(view.querySelectorAll("button")).find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
const click = async (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
const log = (view: HTMLElement) =>
  view.querySelector('[data-testid="assistant-log"]')?.textContent ?? "";
const nl = assistantCopy.nl.chat;

test("a device vault (no chat): an unknown question gets only the old line, no feature is named, nothing is requested", async () => {
  const net = stubNetwork();
  const view = await mount();
  await ask(view, "Wat is de zin van het leven?");
  expect(log(view)).toContain(assistantCopy.nl.unknown);
  expect(log(view)).not.toContain(nl.needsAccount);
  expect(net.fetchMock).not.toHaveBeenCalled();
  expect(view.querySelector('[data-testid="assistant-optin"]')).toBeNull();
});

test("an account but no AI service on the server: the same old line, no request to the assistant route", async () => {
  const net = stubNetwork({ configured: false });
  const view = await mount(withChat);
  await ask(view, "Wat is de zin van het leven?");
  expect(log(view)).toContain(assistantCopy.nl.unknown);
  expect(log(view)).not.toContain(nl.needsAccount);
  expect(net.assistantBodies).toHaveLength(0);
  expect(view.querySelector('[data-testid="assistant-optin"]')).toBeNull();
});

test("not opted in: an unknown question shows the opt-in card with what is sent; nothing is sent", async () => {
  const net = stubNetwork();
  const view = await mount(withChat);
  await ask(view, "Hoeveel gaf ik uit aan eten?");
  const card = view.querySelector('[data-testid="assistant-optin"]')!;
  expect(card.textContent).toContain("Mistral (EU)");
  expect(card.textContent).toContain(
    "namen van tegenpartijen (winkels, maar ook personen en bedrijven waaraan je betaalt of van wie je geld krijgt), van je rekeningen en van rekeningen die je zelf invoerde, en de namen van je vaste lasten, facturen en abonnementen. Een rekeningnaam kan de naam van een persoon bevatten.",
  );
  expect(card.textContent).toContain(
    "Rekeningnummers halen we eruit voordat er iets verstuurd wordt",
  );
  expect(card.textContent).toContain(
    "Eerdere regels van dit gesprek gaan mee, zodat een vervolgvraag klopt",
  );
  expect(card.textContent).toContain("LaVega bewaart het gesprek niet");
  expect(card.textContent).toContain("Je kunt dit altijd uitzetten");
  expect(card.textContent).not.toMatch(/trainen|bewaart Mistral|retention/i);
  expect(button(view, "Aanzetten")).toBeDefined();
  expect(button(view, "Niet nu")).toBeDefined();
  expect(net.assistantBodies).toHaveLength(0);
  expect(localStorage.getItem("lavega.aiAssistant.u1")).toBeNull();
});

test("not opted in: the local skills still answer, with no network", async () => {
  const net = stubNetwork();
  const view = await mount(withChat);
  await ask(view, "Wat zijn mijn saldo's?");
  expect(log(view)).toContain("Saldo's");
  expect(net.assistantBodies).toHaveLength(0);
  expect(view.querySelector('[data-testid="assistant-optin"]')).toBeNull();
});

test("Niet nu closes the card, says what still works, and sends nothing", async () => {
  const net = stubNetwork();
  const view = await mount(withChat);
  await ask(view, "Hoeveel gaf ik uit aan eten?");
  await click(button(view, "Niet nu")!);
  expect(view.querySelector('[data-testid="assistant-optin"]')).toBeNull();
  expect(log(view)).toContain(nl.declined);
  expect(net.assistantBodies).toHaveLength(0);
  expect(localStorage.getItem("lavega.aiAssistant.u1")).toBeNull();
});

test("Aanzetten stores the choice and answers the question that was waiting, with the step label shown", async () => {
  let release!: (r: Response) => void;
  const net = stubNetwork({
    assistant: (_b, n) =>
      n === 1
        ? toolCalls({ id: "abc123XYZ", name: "spending_on_day", args: { date: "2026-11-17" } })
        : new Promise<Response>((r) => (release = r)),
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  await click(button(view, "Aanzetten")!);
  expect(localStorage.getItem("lavega.aiAssistant.u1")).toBe("1");
  expect(view.querySelector('[data-testid="assistant-optin"]')).toBeNull();
  // round 2 is pending: the step label from the tool name, and one quiet announcement
  expect(view.querySelector('[data-testid="assistant-step"]')?.textContent).toBe(
    nl.steps.spending_on_day,
  );
  expect(view.querySelector('[role="status"]')?.textContent).toBe(nl.working);
  await act(async () => {
    release(answer("Gisteren gaf je € 32,35 uit."));
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(log(view)).toContain("Gisteren gaf je € 32,35 uit.");
  expect(view.querySelector('[data-testid="assistant-step"]')).toBeNull();
  // the user's question is in the log once
  expect(log(view).split("Wat gaf ik gisteren uit?").length - 1).toBe(1);
  expect(net.assistantBodies).toHaveLength(2);
  const second = net.assistantBodies[1]!.messages;
  expect(JSON.parse(second.find((m) => m.role === "tool")!.content).data.total.cents).toBe(3235);
});

test("the message list is a polite log region and the answer is plain text with line breaks", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  stubNetwork({ assistant: () => answer("<b>Je hebt</b> twee dingen:\n- Netflix\n- Spotify") });
  const view = await mount(withChat);
  await ask(view, "Welke abonnementen heb ik?");
  const region = view.querySelector('[data-testid="assistant-log"]')!;
  expect(region.getAttribute("role")).toBe("log");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.querySelector("b")).toBeNull();
  const bubble = Array.from(region.querySelectorAll("p")).find((p) =>
    p.textContent?.includes("Netflix"),
  )!;
  expect(bubble.textContent).toBe("<b>Je hebt</b> twee dingen:\n- Netflix\n- Spotify");
  expect(bubble.className).toContain("whitespace-pre-wrap");
});

test("opted in: a follow-up carries the earlier turns as text", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork({
    assistant: (_b, n) => answer(n === 1 ? "Eerste antwoord." : "Tweede antwoord."),
  });
  const view = await mount(withChat);
  await ask(view, "Welke abonnementen heb ik?");
  await ask(view, "En vorige maand?");
  expect(net.assistantBodies).toHaveLength(2);
  expect(net.assistantBodies[1]!.messages).toEqual([
    { role: "user", content: "Welke abonnementen heb ik?" },
    { role: "assistant", content: "Eerste antwoord." },
    { role: "user", content: "En vorige maand?" },
  ]);
});

test("an English question is sent with English as the answer language", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork();
  const view = await mount(withChat);
  await ask(view, "What did I spend yesterday?");
  expect(net.assistantBodies[0]!.locale).toBe("en");
});

test("a remember request stays local even when opted in", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork();
  const view = await mount(withChat);
  await ask(view, "Onthoud dat ik korte antwoorden wil");
  expect(view.querySelector('[data-testid="assistant-approval"]')).not.toBeNull();
  expect(net.assistantBodies).toHaveLength(0);
});

test("a server that is down gives one plain line and a retry that does not repeat the question", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork({
    assistant: (_b, n) =>
      n === 1
        ? new Response(JSON.stringify({ code: "ai-fault" }), { status: 502 })
        : answer("Nu lukt het."),
  });
  const view = await mount(withChat);
  await ask(view, "Welke abonnementen heb ik?");
  expect(view.textContent).toContain(nl.error.unavailable);
  await click(button(view, nl.error.retry)!);
  expect(log(view)).toContain("Nu lukt het.");
  expect(view.textContent).not.toContain(nl.error.unavailable);
  expect(log(view).split("Welke abonnementen heb ik?").length - 1).toBe(1);
  expect(net.assistantBodies).toHaveLength(2);
  expect(net.assistantBodies[1]!.messages).toEqual([
    { role: "user", content: "Welke abonnementen heb ik?" },
  ]);
});

test("offline, rate-limited and over budget each get their own plain line", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const cases: [Response | Error, string][] = [
    [new TypeError("Failed to fetch"), nl.error.unavailable],
    [
      new Response(JSON.stringify({ code: "assistant-rate-limited-hour" }), { status: 429 }),
      nl.error.rate,
    ],
    [new Response(JSON.stringify({ code: "ai-budget-day" }), { status: 429 }), nl.error.budget],
    [new Response("{}", { status: 401 }), nl.error.signedOut],
  ];
  for (const [response, line] of cases) {
    vi.unstubAllGlobals();
    stubNetwork({
      assistant: () => {
        if (response instanceof Error) throw response;
        return response.clone();
      },
    });
    const view = await mount(withChat);
    await ask(view, "Welke abonnementen heb ik?");
    expect(view.textContent, line).toContain(line);
    act(() => root!.unmount());
    view.remove();
    root = null;
  }
});

test("a checked-twice failure shows the plain facts, an advice refusal shows the fixed line", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  stubNetwork({
    assistant: (_b, n) => {
      if (n === 1)
        return toolCalls({
          id: "abc123XYZ",
          name: "spending_on_day",
          args: { date: "2026-11-17" },
        });
      return answer("Dat was € 41.");
    },
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  expect(log(view)).toContain(nl.factsHeader);
  expect(log(view)).toContain("€ 32,35");
  expect(log(view)).not.toContain("€ 41");
  act(() => root!.unmount());
  view.remove();
  vi.unstubAllGlobals();
  stubNetwork({ assistant: () => answer("Je kunt het beste ETF's kopen.") });
  const second = await mount(withChat);
  await ask(second, "Moet ik ETF's kopen?");
  expect(log(second)).toContain(nl.adviceRefusal);
  expect(log(second)).not.toContain("beste");
});

test("Uitzetten clears the choice; the next unknown question shows the card again and sends nothing", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork();
  const view = await mount(withChat);
  await click(button(view, nl.turnOff)!);
  expect(localStorage.getItem("lavega.aiAssistant.u1")).toBe("0");
  expect(button(view, nl.turnOff)).toBeUndefined();
  await ask(view, "Hoeveel gaf ik uit aan eten?");
  expect(view.querySelector('[data-testid="assistant-optin"]')).not.toBeNull();
  expect(net.assistantBodies).toHaveLength(0);
});

test("D5: one short chat line says 'geen financieel advies', once, not the plan-page footer; D1/D2 privacy line", async () => {
  stubNetwork();
  const view = await mount(withChat);
  const text = view.textContent ?? "";
  expect(nl.notice).toBe(
    "De assistent geeft informatie over je eigen cijfers, geen financieel advies.",
  );
  expect(assistantCopy.en.chat.notice).toBe(
    "The assistant gives information about your own figures, not financial advice.",
  );
  expect(text.split(nl.notice).length - 1).toBe(1);
  expect(text).not.toContain("De vergelijking");
  expect(text).toContain(nl.intro);
  expect(view.querySelector('[data-testid="assistant-privacy"]')?.textContent).toBe(
    "LaVega bewaart je gesprek niet. Rekeningnummers halen we eruit voordat er iets verstuurd wordt.",
  );
  expect(assistantCopy.en.chat.privacy).toBe(
    "LaVega does not keep your conversation. We remove account numbers before anything is sent.",
  );
  await ask(view, "Hoeveel gaf ik uit aan eten?");
  expect((view.textContent ?? "").split(nl.notice).length - 1).toBe(1);
});

test("English: the card and the lines are in English", async () => {
  stubNetwork();
  const view = await mount(withChat, "en");
  await ask(view, "Which of my payments looks odd?");
  const card = view.querySelector('[data-testid="assistant-optin"]')!.textContent ?? "";
  expect(card).toContain("Mistral (EU)");
  expect(card).toContain(
    "and the names of the fixed costs, invoices and subscriptions you have in the app. An account name can contain a person's name.",
  );
  expect(card).toContain("We remove account numbers before anything is sent");
  expect(button(view, "Turn on")).toBeDefined();
  expect(button(view, "Not now")).toBeDefined();
});

test("the input keeps focus after a question is sent", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  stubNetwork();
  const view = await mount(withChat);
  const input = view.querySelector<HTMLInputElement>("#assistant-input")!;
  input.focus();
  await ask(view, "Welke abonnementen heb ik?");
  expect(document.activeElement).toBe(input);
});

test("a vault that cannot be read is the existing read error, nothing is sent", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork();
  const broken = {
    ...storage,
    getRules: async () => Promise.reject(new Error("locked")),
  } as unknown as VaultStorage;
  const view = await mount({ ...withChat, storage: broken });
  await ask(view, "Welke abonnementen heb ik?");
  expect(log(view)).toContain(assistantCopy.nl.readError);
  expect(net.assistantBodies).toHaveLength(0);
});

/* --- A1: consent withdrawn means nothing more is sent --- */

test("A1: after a failure and a switch-off, the retry is gone and no request can go out", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork({
    assistant: () => new Response(JSON.stringify({ code: "ai-fault" }), { status: 502 }),
  });
  const view = await mount(withChat);
  await ask(view, "Welke abonnementen heb ik?");
  expect(button(view, nl.error.retry)).toBeDefined();
  await click(button(view, nl.turnOff)!);
  expect(button(view, nl.error.retry)).toBeUndefined();
  expect(view.querySelector('[data-testid="assistant-chat-error"]')).toBeNull();
  expect(net.assistantBodies).toHaveLength(1);
});

test("A1: switching off while a question is in flight: the pending answer arrives and nothing more is sent", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  let release!: (r: Response) => void;
  const net = stubNetwork({
    assistant: (_b, n) => (n === 1 ? new Promise<Response>((r) => (release = r)) : answer("nooit")),
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  expect(net.assistantBodies).toHaveLength(1);
  await click(button(view, nl.turnOff)!);
  await act(async () => {
    release(
      toolCalls({
        id: "abc123XYZ",
        name: "transactions",
        args: { from: "2026-08-01", to: "2026-11-18", sort: "date_desc", limit: 25 },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(net.assistantBodies).toHaveLength(1);
  expect(log(view)).not.toContain("nooit");
  expect(view.querySelector('[data-testid="assistant-step"]')).toBeNull();
  expect(view.querySelector('[data-testid="assistant-chat-error"]')).toBeNull();
});

test("A1: the flag is read at send time: a switch-off in another tab holds at the next send", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  let release!: (r: Response) => void;
  const net = stubNetwork({
    assistant: (_b, n) => (n === 1 ? new Promise<Response>((r) => (release = r)) : answer("nooit")),
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  localStorage.setItem("lavega.aiAssistant.u1", "0"); // another tab
  await act(async () => {
    release(toolCalls({ id: "abc123XYZ", name: "balances", args: {} }));
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(net.assistantBodies).toHaveLength(1);
});

test("A1: unmounting mid-question sends nothing more", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  let release!: (r: Response) => void;
  const net = stubNetwork({
    assistant: (_b, n) => (n === 1 ? new Promise<Response>((r) => (release = r)) : answer("nooit")),
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  act(() => root!.unmount());
  root = null;
  await act(async () => {
    release(toolCalls({ id: "abc123XYZ", name: "balances", args: {} }));
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(net.assistantBodies).toHaveLength(1);
  view.remove();
});

test("A8: another account on this browser is asked itself", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const net = stubNetwork();
  const view = await mount({ chat: { plan: null, accountId: "u2", ...lists } });
  await ask(view, "Hoeveel gaf ik uit aan eten?");
  expect(view.querySelector('[data-testid="assistant-optin"]')).not.toBeNull();
  expect(net.assistantBodies).toHaveLength(0);
});

/* --- A7: nothing from before the opt-in goes along --- */

test("A7: accepting the card sends the waiting question only, not the earlier local turns", async () => {
  const net = stubNetwork();
  const view = await mount(withChat);
  await ask(view, "Wat zijn mijn saldo's?"); // answered locally, before the opt-in
  await ask(view, "Hoeveel gaf ik uit aan eten?");
  await click(button(view, "Aanzetten")!);
  expect(net.assistantBodies).toHaveLength(1);
  expect(net.assistantBodies[0]!.messages).toEqual([
    { role: "user", content: "Hoeveel gaf ik uit aan eten?" },
  ]);
  await ask(view, "En vorige maand?");
  expect(net.assistantBodies[1]!.messages.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "user",
  ]);
  expect(JSON.stringify(net.assistantBodies[1]!.messages)).not.toContain("Saldo");
});

/* --- B1 / B3 / B5 --- */

test("B1: the chat reads the scoped lists the app hands it, and its results name the scope", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  stubNetwork({
    assistant: (b) => {
      bodies.push(b);
      return b.messages.some((m) => m.role === "tool")
        ? answer("Klaar.")
        : toolCalls({ id: "abc123XYZ", name: "balances", args: {} });
    },
  });
  const onlyOne = [vault.accounts[1]!];
  const view = await mount({
    chat: { plan: null, accountId: "u1", ...lists, accounts: onlyOne, txs: [], scope: "zakelijk" },
  });
  await ask(view, "Wat zijn mijn saldo's?");
  const tool = bodies[1]!.messages.find((m) => m.role === "tool")!;
  const parsed = JSON.parse(tool.content);
  expect(parsed.scope).toBe("zakelijk");
  expect(parsed.data.accounts).toHaveLength(1);
});

test("B3: the question carries the Amsterdam day as the browser computed it for THIS question", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-30T23:30:00Z"));
  try {
    const net = stubNetwork();
    const view = await mount(withChat);
    await ask(view, "Welke abonnementen heb ik?");
    expect((net.assistantBodies[0] as unknown as { today: string }).today).toBe("2026-12-01");
  } finally {
    vi.useRealTimers();
  }
});

test("B5: offline while opted in: a balance or this-month question is answered locally, so 'werken nog' is true", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  stubNetwork({
    assistant: () => {
      throw new TypeError("Failed to fetch");
    },
  });
  const view = await mount(withChat);
  await ask(view, "Wat zijn mijn saldo's?");
  expect(log(view)).toContain("Saldo's");
  expect(view.querySelector('[data-testid="assistant-chat-error"]')).toBeNull();
  await ask(view, "Welke abonnementen heb ik?"); // not a local skill: the plain line
  expect(view.textContent).toContain(nl.error.unavailable);
});

test("D7: a long unbroken token cannot overflow the column", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  stubNetwork({ assistant: () => answer("x".repeat(300)) });
  const view = await mount(withChat);
  await ask(view, "Welke abonnementen heb ik?");
  const bubbles = Array.from(view.querySelectorAll('[data-testid="assistant-log"] p'));
  expect(bubbles.every((p) => p.className.includes("break-words"))).toBe(true);
});

test("a turn never ends in silence: when the model only keeps making bad calls the user gets the honest line", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  stubNetwork({
    assistant: () =>
      toolCalls({ id: "abc123XYZ", name: "spending_on_day", args: { date: "gisteren" } }),
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  expect(log(view)).toContain(
    "Dat lukte me niet in één keer. Stel je vraag iets specifieker, bijvoorbeeld met een periode.",
  );
  expect(assistantCopy.en.chat.noAnswer).toBe(
    "I could not do that in one go. Ask a little more specifically, for example with a period.",
  );
});

test("the phone sheet: a short placeholder that fits, and the tool label shows in the same component", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  let release!: (r: Response) => void;
  stubNetwork({
    assistant: (_b, n) =>
      n === 1
        ? toolCalls({ id: "abc123XYZ", name: "balances", args: {} })
        : new Promise<Response>((r) => (release = r)),
  });
  const view = await mount(withChat);
  const input = view.querySelector<HTMLInputElement>("#assistant-input")!;
  expect(input.placeholder).toBe("Vraag naar je geld");
  expect(input.placeholder.length).toBeLessThanOrEqual(24);
  expect(input.className).toContain("text-ellipsis");
  expect(assistantCopy.en.chat.placeholder).toBe("Ask about your money");
  await ask(view, "Wat zijn mijn saldo's?");
  expect(view.querySelector('[data-testid="assistant-step"]')?.textContent).toBe(nl.steps.balances);
  await act(async () => {
    release(answer("Klaar."));
    await new Promise((r) => setTimeout(r, 0));
  });
});

test("a scope switch while a question runs aborts it: nothing more is sent under the old scope", async () => {
  localStorage.setItem("lavega.aiAssistant.u1", "1");
  let release!: (r: Response) => void;
  const net = stubNetwork({
    assistant: (_b, n) => (n === 1 ? new Promise<Response>((r) => (release = r)) : answer("nooit")),
  });
  const view = await mount(withChat);
  await ask(view, "Wat gaf ik gisteren uit?");
  expect(net.assistantBodies).toHaveLength(1);
  await act(async () => {
    root!.render(
      <AssistantPanel
        storage={storage}
        asOf="2026-11-18"
        chat={{ ...withChat.chat, scope: "zakelijk" }}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    release(toolCalls({ id: "abc123XYZ", name: "balances", args: {} }));
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(net.assistantBodies).toHaveLength(1);
  expect(log(view)).not.toContain("nooit");
});
