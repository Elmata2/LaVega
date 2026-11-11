// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentApi, AgentSettingsLoad, AgentSettingsRecord } from "../api.js";
import type { View } from "../appRoutes.js";
import type { PushBrowser } from "../agent/pushBrowser.js";
import { instinctCopy } from "../copy/instinct.js";
import AgentSettings from "./AgentSettings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const V = "2026-11-v1";
const NL_CONSENT =
  "LaVega leest elke nacht je transacties om je meldingen te sturen, en bewaart ze niet.";
const c = instinctCopy.nl;

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const on = (over: Partial<AgentSettingsRecord> = {}): AgentSettingsRecord => ({
  enabled: true,
  channels: ["feed"],
  sendHour: 8,
  locale: "nl",
  email: null,
  consentVersion: V,
  consentedAt: "2026-11-10T08:00:00Z",
  ...over,
});

function load(over: Partial<Extract<AgentSettingsLoad, { kind: "ok" }>> = {}): AgentSettingsLoad {
  return {
    kind: "ok",
    settings: null,
    bankConnected: true,
    consentVersion: V,
    vapidPublicKey: "KEY",
    ...over,
  };
}

function fakeApi(first: AgentSettingsLoad, over: Partial<AgentApi> = {}): AgentApi {
  return {
    getSettings: vi.fn(async () => first),
    putSettings: vi.fn(async () => ({ kind: "ok" as const })),
    turnOff: vi.fn(async () => ({ kind: "ok" as const })),
    putPush: vi.fn(async () => true),
    deletePush: vi.fn(async () => true),
    listFeed: vi.fn(async () => ({ kind: "ok" as const, events: [], next: null })),
    deleteEvent: vi.fn(async () => true),
    getWhatsapp: vi.fn(async () => ({
      kind: "ok" as const,
      linked: false,
      phone: null,
      number: "+31 6 1111 2222",
    })),
    createLinkCode: vi.fn(async () => ({
      kind: "ok" as const,
      code: "LV-ABCD2345",
      expiresAt: "2026-11-10T08:15:00Z",
      number: "+31 6 1111 2222",
    })),
    unlinkWhatsapp: vi.fn(async () => true),
    deleteConversation: vi.fn(async () => true),
    ...over,
  };
}

function fakeBrowser(over: Partial<PushBrowser> = {}): PushBrowser {
  return {
    supported: () => true,
    permission: () => "default",
    request: vi.fn(async () => "granted" as const),
    subscribe: vi.fn(async () => ({
      endpoint: "https://push.example/1",
      keys: { p256dh: "p", auth: "a" },
    })),
    unsubscribe: vi.fn(async () => "https://push.example/1"),
    ...over,
  };
}

async function render(
  api: AgentApi,
  extra: {
    browser?: PushBrowser;
    locale?: "nl" | "en";
    onEnabledChange?: (on: boolean) => void;
    onNavigate?: (v: View) => void;
  } = {},
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AgentSettings
        locale={extra.locale ?? "nl"}
        accountEmail="ik@example.nl"
        api={api}
        browser={extra.browser ?? fakeBrowser()}
        {...(extra.onEnabledChange ? { onEnabledChange: extra.onEnabledChange } : {})}
        {...(extra.onNavigate ? { onNavigate: extra.onNavigate } : {})}
      />,
    );
  });
  return container;
}

const button = (label: string) =>
  [...container!.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
const click = async (el: Element | undefined) => {
  await act(async () => (el as HTMLElement).click());
};
const checkbox = (label: string) =>
  [...container!.querySelectorAll("label")]
    .find((l) => l.textContent?.includes(label))
    ?.querySelector("input") as HTMLInputElement;
/** Ticks the WhatsApp AI consent (once), then presses "Koppel WhatsApp". */
const startLink = async () => {
  const agree = checkbox(c.whatsappAiConsent);
  if (agree && !agree.checked) await click(agree);
  await click(button(c.whatsappLink));
};

test("the consent sentence is shown verbatim and Zet aan needs the checkbox", async () => {
  const api = fakeApi(load());
  await render(api);
  expect(c.consent).toBe(NL_CONSENT);
  expect(container!.querySelector('[data-testid="instinct-consent"]')!.textContent).toBe(
    NL_CONSENT,
  );
  expect(button(c.turnOn)!.disabled).toBe(true);
  await click(checkbox(c.consentCheckbox));
  expect(button(c.turnOn)!.disabled).toBe(false);
  expect(container!.textContent).toContain(c.offNote);
  expect(container!.textContent).toContain(c.timeNotice);
});

test("turning on sends the default 08:00, the feed channel and the consent version", async () => {
  const api = fakeApi(load());
  const onEnabledChange = vi.fn();
  await render(api, { onEnabledChange });
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(api.putSettings).toHaveBeenCalledWith({
    enabled: true,
    channels: ["feed"],
    sendHour: 8,
    locale: "nl",
    email: null,
    consentVersion: V,
  });
  expect(onEnabledChange).toHaveBeenCalledWith(true);
  expect(button(c.turnOff)).toBeDefined();
});

test("email is prefilled from the account and sent when ticked", async () => {
  const api = fakeApi(load());
  await render(api);
  await click(checkbox(c.channels.email));
  const input = container!.querySelector<HTMLInputElement>('input[type="email"]')!;
  expect(input.value).toBe("ik@example.nl");
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(api.putSettings).toHaveBeenCalledWith(
    expect.objectContaining({ channels: ["feed", "email"], email: "ik@example.nl" }),
  );
});

const linkedWa = {
  kind: "ok" as const,
  linked: true,
  phone: "+•••••••••78",
  number: "+31 6 1111 2222",
};
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

test("WhatsApp cannot be ticked until a number is linked", async () => {
  await render(fakeApi(load({ settings: on() })));
  expect(checkbox(c.whatsapp).disabled).toBe(true);
  expect(container!.textContent).toContain(c.whatsappNeedsLink);
});

test("a linked number enables the checkbox, shows the masked number only, and saves the channel", async () => {
  const api = fakeApi(load({ settings: on() }), { getWhatsapp: vi.fn(async () => linkedWa) });
  await render(api);
  expect(checkbox(c.whatsapp).disabled).toBe(false);
  expect(container!.textContent).toContain(c.whatsappLinked("+•••••••••78"));
  await click(checkbox(c.whatsapp));
  await click(button(c.save));
  expect(api.putSettings).toHaveBeenCalledWith(
    expect.objectContaining({ channels: ["feed", "whatsapp"] }),
  );
});

test("before the message is on, linking is not offered", async () => {
  await render(fakeApi(load()));
  expect(button(c.whatsappLink)).toBeUndefined();
  expect(container!.textContent).toContain(c.whatsappNeedsOn);
});

test("the code panel shows the code, the number to message and the expiry as a time", async () => {
  const api = fakeApi(load({ settings: on() }));
  await render(api);
  await startLink();
  expect(api.createLinkCode).toHaveBeenCalledTimes(1);
  const text = container!.textContent!;
  expect(text).toContain("LV-ABCD2345");
  expect(text).toContain(c.whatsappSend("+31 6 1111 2222"));
  expect(text).toContain(c.whatsappExpires("09:15"));
  expect(container!.querySelector('[role="status"]')!.textContent).toContain(c.whatsappWaiting);
  expect(text).not.toMatch(/\+31612345678/);
});

test("one always-mounted status region exists before linking and gets the linked text", async () => {
  vi.useFakeTimers();
  try {
    const getWhatsapp = vi
      .fn()
      .mockResolvedValueOnce({ kind: "ok", linked: false, phone: null, number: "n" })
      .mockResolvedValue(linkedWa);
    await render(fakeApi(load({ settings: on() }), { getWhatsapp }));
    const region = container!.querySelector('[data-testid="wa-status"]')!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");
    await startLink();
    expect(container!.querySelector('[data-testid="wa-status"]')).toBe(region);
    expect(region.textContent).toContain(c.whatsappWaiting);
    await tick(3000);
    expect(container!.querySelector('[data-testid="wa-status"]')).toBe(region);
    expect(region.textContent).toContain(c.whatsappLinkedNow);
  } finally {
    vi.useRealTimers();
  }
});

test("focus moves to the code on open, back to Koppel on Sluiten and on Ontkoppel", async () => {
  const api = fakeApi(load({ settings: on() }));
  await render(api);
  await startLink();
  const code = container!.querySelector("code")!;
  expect(code.getAttribute("tabindex")).toBe("-1");
  expect(code.hasAttribute("aria-labelledby")).toBe(false);
  expect(document.activeElement).toBe(code);
  expect(container!.querySelector('[role="group"]')).not.toBeNull();
  await click(button(c.whatsappClose));
  expect(document.activeElement).toBe(button(c.whatsappLink));

  act(() => root!.unmount());
  container!.remove();
  const linked = fakeApi(load({ settings: on() }), { getWhatsapp: vi.fn(async () => linkedWa) });
  await render(linked);
  await click(button(c.whatsappUnlink));
  expect(document.activeElement).toBe(button(c.whatsappLink));
});

test("a failed link-code request shows a reason", async () => {
  const api = fakeApi(load({ settings: on() }), {
    createLinkCode: vi.fn(async () => ({ kind: "unavailable" as const })),
  });
  await render(api);
  await startLink();
  expect(container!.querySelector('[role="alert"]')!.textContent).toContain(c.whatsappLinkFailed);
});

test("polling runs every 3 s, stops on linked and shows the result", async () => {
  vi.useFakeTimers();
  try {
    const getWhatsapp = vi
      .fn()
      .mockResolvedValueOnce({ kind: "ok", linked: false, phone: null, number: "n" })
      .mockResolvedValueOnce({ kind: "ok", linked: false, phone: null, number: "n" })
      .mockResolvedValue(linkedWa);
    await render(fakeApi(load({ settings: on() }), { getWhatsapp }));
    await startLink();
    expect(getWhatsapp).toHaveBeenCalledTimes(1);
    await tick(2999);
    expect(getWhatsapp).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(getWhatsapp).toHaveBeenCalledTimes(2);
    await tick(3000);
    expect(getWhatsapp).toHaveBeenCalledTimes(3);
    expect(container!.textContent).not.toContain("LV-ABCD2345");
    expect(container!.textContent).toContain(c.whatsappLinkedNow);
    expect(checkbox(c.whatsapp).disabled).toBe(false);
    await tick(30_000);
    expect(getWhatsapp).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

test("polling stops after 15 minutes and asks for a new code", async () => {
  vi.useFakeTimers();
  try {
    const api = fakeApi(load({ settings: on() }));
    await render(api);
    await startLink();
    await tick(15 * 60_000);
    const calls = (api.getWhatsapp as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(container!.textContent).toContain(c.whatsappTimedOut);
    await tick(60_000);
    expect((api.getWhatsapp as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  } finally {
    vi.useRealTimers();
  }
});

test("closing the panel and unmounting both stop polling", async () => {
  vi.useFakeTimers();
  try {
    const api = fakeApi(load({ settings: on() }));
    await render(api);
    await startLink();
    await click(button(c.whatsappClose));
    const getWhatsapp = api.getWhatsapp as ReturnType<typeof vi.fn>;
    const afterClose = getWhatsapp.mock.calls.length;
    await tick(10_000);
    expect(getWhatsapp.mock.calls.length).toBe(afterClose);
    await startLink();
    const beforeUnmount = getWhatsapp.mock.calls.length;
    act(() => root!.unmount());
    root = null;
    await tick(10_000);
    expect(getWhatsapp.mock.calls.length).toBe(beforeUnmount);
  } finally {
    vi.useRealTimers();
  }
});

test("unlinking drops the WhatsApp channel and saves", async () => {
  const api = fakeApi(load({ settings: on({ channels: ["feed", "whatsapp"] }) }), {
    getWhatsapp: vi.fn(async () => linkedWa),
  });
  await render(api);
  await click(button(c.whatsappUnlink));
  expect(api.unlinkWhatsapp).toHaveBeenCalledTimes(1);
  expect(api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ channels: ["feed"] }));
  expect(checkbox(c.whatsapp).disabled).toBe(true);
  expect(checkbox(c.whatsapp).checked).toBe(false);
  expect(button(c.whatsappLink)).toBeDefined();
});

test("no bank: the button is disabled, the reason is given and links to Rekeningen", async () => {
  const onNavigate = vi.fn();
  await render(fakeApi(load({ bankConnected: false })), { onNavigate });
  await click(checkbox(c.consentCheckbox));
  expect(button(c.turnOn)!.disabled).toBe(true);
  expect(container!.textContent).toContain(c.noBank);
  await click(button(c.bankLink));
  expect(onNavigate).toHaveBeenCalledWith("accounts");
});

test("a 409 bank-required on save shows the message with the Rekeningen link", async () => {
  const api = fakeApi(load(), {
    putSettings: vi.fn(async () => ({ kind: "bank-required" as const })),
  });
  const onNavigate = vi.fn();
  await render(api, { onNavigate });
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(container!.querySelector('[role="alert"]')!.textContent).toContain(c.bankRequired);
  await click(button(c.bankLink));
  expect(onNavigate).toHaveBeenCalledWith("accounts");
});

test("a 503 when loading says alerts are unavailable and offers no switch", async () => {
  await render(fakeApi({ kind: "unavailable" }));
  expect(container!.textContent).toContain("Meldingen zijn nu niet beschikbaar");
  expect(button(c.turnOn)).toBeUndefined();
});

test("a 503 on save says alerts are unavailable", async () => {
  const api = fakeApi(load(), {
    putSettings: vi.fn(async () => ({ kind: "unavailable" as const })),
  });
  await render(api);
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(container!.querySelector('[role="alert"]')!.textContent).toBe(c.unavailable);
});

test("turning off asks first, then sends enabled:false and shows the empty state", async () => {
  const api = fakeApi(load({ settings: on() }));
  const onEnabledChange = vi.fn();
  await render(api, { onEnabledChange });
  await click(button(c.turnOff));
  expect(container!.textContent).toContain(
    "Uitzetten verwijdert alles wat LaVega op de server voor deze functie bewaart.",
  );
  expect(api.turnOff).not.toHaveBeenCalled();
  await click(button(c.turnOffConfirmYes));
  expect(api.turnOff).toHaveBeenCalledTimes(1);
  expect(onEnabledChange).toHaveBeenCalledWith(false);
  expect(container!.textContent).toContain(c.storedEmpty);
  expect(button(c.turnOn)).toBeDefined();
});

test("cancelling the turn off confirm changes nothing", async () => {
  const api = fakeApi(load({ settings: on() }));
  await render(api);
  await click(button(c.turnOff));
  await click(button(c.turnOffConfirmNo));
  expect(api.turnOff).not.toHaveBeenCalled();
  expect(button(c.turnOff)).toBeDefined();
});

test("opening the turn off confirm moves focus to the cancel button", async () => {
  const api = fakeApi(load({ settings: on() }));
  await render(api);
  await click(button(c.turnOff));
  expect(document.activeElement).toBe(button(c.turnOffConfirmNo));
});

test("cancelling the turn off confirm returns focus to the Zet uit button", async () => {
  const api = fakeApi(load({ settings: on() }));
  await render(api);
  await click(button(c.turnOff));
  await click(button(c.turnOffConfirmNo));
  expect(container!.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(button(c.turnOff));
});

test("push subscribe failing after save: box unticked, server re-PUT without push, message shown", async () => {
  const browser = fakeBrowser({
    subscribe: vi.fn(async () => {
      throw new Error("no sub");
    }),
  });
  const api = fakeApi(load());
  await render(api, { browser });
  await click(checkbox(c.channels.push));
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(api.putSettings).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.putSettings).mock.calls[0]![0].channels).toEqual(["feed", "push"]);
  expect(vi.mocked(api.putSettings).mock.calls[1]![0].channels).toEqual(["feed"]);
  expect(checkbox(c.channels.push).checked).toBe(false);
  expect(container!.querySelector('[role="alert"]')!.textContent).toBe(c.pushFailed);
});

test("push: permission is asked only when the box is ticked, then subscribed on save", async () => {
  const browser = fakeBrowser();
  const api = fakeApi(load());
  await render(api, { browser });
  expect(browser.request).not.toHaveBeenCalled();
  await click(checkbox(c.channels.push));
  expect(browser.request).toHaveBeenCalledTimes(1);
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(api.putSettings).toHaveBeenCalledWith(
    expect.objectContaining({ channels: ["feed", "push"] }),
  );
  expect(browser.subscribe).toHaveBeenCalledWith("KEY");
  expect(api.putPush).toHaveBeenCalledWith(
    expect.objectContaining({ endpoint: "https://push.example/1" }),
  );
});

test("push permission denied: the box stays unticked and the message says why", async () => {
  const browser = fakeBrowser({ request: vi.fn(async () => "denied" as const) });
  const api = fakeApi(load());
  await render(api, { browser });
  await click(checkbox(c.channels.push));
  expect(checkbox(c.channels.push).checked).toBe(false);
  expect(container!.querySelector('[role="alert"]')!.textContent).toBe(c.pushDenied);
  await click(checkbox(c.consentCheckbox));
  await click(button(c.turnOn));
  expect(api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ channels: ["feed"] }));
  expect(browser.subscribe).not.toHaveBeenCalled();
});

test("push already blocked in the browser: no prompt, same message", async () => {
  const browser = fakeBrowser({ permission: () => "denied" });
  await render(fakeApi(load()), { browser });
  await click(checkbox(c.channels.push));
  expect(browser.request).not.toHaveBeenCalled();
  expect(container!.textContent).toContain(c.pushDenied);
});

test("push unsupported: the box is disabled with a clear message", async () => {
  await render(fakeApi(load()), { browser: fakeBrowser({ supported: () => false }) });
  expect(checkbox(c.channels.push).disabled).toBe(true);
  expect(container!.textContent).toContain(c.pushUnsupported);
});

test("outdated consent shows a re-consent prompt and saves with the current version", async () => {
  const api = fakeApi(load({ settings: on({ consentVersion: "2026-01-v0" }) }));
  await render(api);
  expect(container!.textContent).toContain(c.reconsentTitle);
  expect(container!.querySelector('[data-testid="instinct-consent"]')!.textContent).toBe(
    NL_CONSENT,
  );
  expect(button(c.reconsentButton)!.disabled).toBe(true);
  await click(checkbox(c.consentCheckbox));
  await click(button(c.reconsentButton));
  expect(api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ consentVersion: V }));
  expect(container!.textContent).not.toContain(c.reconsentTitle);
});

test("current consent shows no consent prompt, only Bewaar", async () => {
  await render(fakeApi(load({ settings: on() })));
  expect(container!.querySelector('[data-testid="instinct-consent"]')).toBeNull();
  expect(button(c.save)).toBeDefined();
});

test("English renders the English consent sentence", async () => {
  await render(fakeApi(load()), { locale: "en" });
  expect(container!.querySelector('[data-testid="instinct-consent"]')!.textContent).toBe(
    instinctCopy.en.consent,
  );
});

test("Koppel WhatsApp stays disabled until the AI consent is ticked, then sends it (F2)", async () => {
  const api = fakeApi(load({ settings: on() }));
  await render(api);
  expect(container!.textContent).toContain(c.whatsappAiConsent);
  expect(button(c.whatsappLink)!.getAttribute("aria-disabled")).toBe("true");
  await click(button(c.whatsappLink));
  expect(api.createLinkCode).not.toHaveBeenCalled();
  await click(checkbox(c.whatsappAiConsent));
  expect(button(c.whatsappLink)!.getAttribute("aria-disabled")).toBe("false");
  await click(button(c.whatsappLink));
  expect(api.createLinkCode).toHaveBeenCalledWith(true);
});

test("the AI consent line is also shown in English", async () => {
  await render(fakeApi(load({ settings: on({ locale: "en" }) })), { locale: "en" });
  expect(container!.textContent).toContain(instinctCopy.en.whatsappAiConsent);
});

test("a signed-out settings load shows the sign-in message, not a load error (F12)", async () => {
  await render(fakeApi({ kind: "signedOut" }));
  expect(container!.textContent).toContain(c.signInNeeded);
  expect(container!.textContent).not.toContain(c.loadFailed);
  expect(button(c.turnOn)).toBeUndefined();
});
