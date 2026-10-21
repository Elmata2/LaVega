// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ForwardingGuide from "./views/ForwardingGuide";
import { adminCopy } from "./copy/admin.js";
import {
  GMAIL_FILTER_QUERY,
  GMAIL_FILTERS_URL,
  GMAIL_FORWARDING_URL,
  OUTLOOK_COM_RULES_URL,
  OUTLOOK_WORK_RULES_URL,
  RULE_WORDS,
  codeStatus,
  TEST_POLL_MS,
  TEST_WINDOW_MS,
  emptyGuideState,
  guideStage,
  setTab,
  startTest,
  testSubject,
  type GuideState,
} from "./forwardingGuide.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = "lavega-abcdefghij@invoices.lavega.dev";
const NOW = 1_800_000_000_000;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

function render(
  lang: "nl" | "en",
  state: GuideState,
  over: Partial<{
    address: string;
    nowMs: number;
    onChange: (u: (prev: GuideState) => GuideState) => void;
    onStartTest: () => void;
    onOpenKoppelingen: () => void;
    /** The guide lives in a modal; most tests want it open. */
    open: boolean;
  }> = {},
) {
  const { open = true, ...rest } = over;
  document.cookie = `lavega_locale=${lang}; Path=/`;
  if (root) act(() => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    address: ADDRESS,
    nowMs: NOW,
    onChange: () => {},
    onStartTest: () => {},
    onOpenKoppelingen: () => {},
    ...rest,
  };
  act(() => {
    root!.render(<ForwardingGuide {...props} state={state} />);
  });
  if (open) openModal();
  return container;
}

/** What a recorded onChange call does to `state` (calls are updaters). */
function applied(call: unknown[], state: GuideState): GuideState {
  return (call[0] as (prev: GuideState) => GuideState)(state);
}

function byText(sel: string, text: string): HTMLElement {
  const el = [...container!.querySelectorAll<HTMLElement>(sel)].find((e) =>
    (e.textContent ?? "").includes(text),
  );
  if (!el) throw new Error(`no <${sel}> with text "${text}"`);
  return el;
}
function opener(): HTMLButtonElement {
  return container!.querySelector<HTMLButtonElement>("section > div > button")!;
}
function dialog(): HTMLDialogElement {
  return container!.querySelector("dialog")!;
}
function openModal() {
  act(() => {
    opener().focus();
    opener().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const waiting = (over: Partial<GuideState> = {}): GuideState => ({
  ...emptyGuideState(),
  ticks: ["gmail:1"],
  codeWaitStartedAtMs: NOW - 1000,
  ...over,
});

for (const lang of ["nl", "en"] as const) {
  const g = adminCopy[lang].facturen.guide;

  test(`${lang}: no address shows the way to Koppelingen and no steps`, () => {
    const onOpen = vi.fn();
    const c = render(lang, emptyGuideState(), { address: "", onOpenKoppelingen: onOpen });
    expect(c.textContent).toContain(g.noAddress);
    expect(c.textContent).not.toContain(g.gmail.openSettings);
    expect(c.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    click(byText("button", g.goCreateAddress));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test(`${lang}: every stage shows progress or an action`, () => {
    const states: Record<string, [GuideState, number]> = {
      "address-ready": [emptyGuideState(), NOW],
      "waiting-for-code": [waiting(), NOW],
      "code-wait-timed-out": [waiting(), NOW + TEST_WINDOW_MS],
      "code-shown": [
        waiting({ confirmation: { code: "123456789", receivedAtMs: NOW, seenAtMs: NOW } }),
        NOW,
      ],
      "test-pending": [startTest(emptyGuideState(), "k3x9", NOW - 1000), NOW],
      "test-passed": [
        {
          ...startTest(emptyGuideState(), "k3x9", NOW - 5000),
          passedAtMs: NOW - 1000,
          test: {
            code: "k3x9",
            startedAtMs: NOW - 5000,
            receivedAtMs: NOW - 1000,
            receivedCode: "k3x9",
          },
        },
        NOW,
      ],
      "test-timed-out": [startTest(emptyGuideState(), "k3x9", NOW - TEST_WINDOW_MS - 1), NOW],
    };
    for (const [stage, [state, nowMs]] of Object.entries(states)) {
      expect(guideStage(state, nowMs, true)).toBe(stage);
      const c = render(lang, state, { nowMs });
      expect(c.textContent, stage).toContain(g.stages[stage as keyof typeof g.stages]);
      const actions = c.querySelectorAll("button, a").length;
      expect(actions, stage).toBeGreaterThan(0);
    }
  });

  test(`${lang}: the Gmail code is text with a copy button, never a link`, async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const c = render(
      lang,
      waiting({ confirmation: { code: "123456789", receivedAtMs: NOW, seenAtMs: NOW } }),
    );
    expect(c.textContent).toContain(g.gmail.step2Code("123456789"));
    for (const a of c.querySelectorAll("a")) {
      expect(a.getAttribute("href") ?? "").not.toContain("mail-settings.google.com");
      expect(a.textContent).not.toContain("123456789");
    }
    expect(c.querySelector('[data-testid="gmail-code"]')?.textContent).toBe("123456789");
    await act(async () => {
      c.querySelector<HTMLElement>('[data-testid="copy-code"]')!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(writeText).toHaveBeenCalledWith("123456789");
  });

  test(`${lang}: a stored code with no active wait is not shown`, () => {
    const c = render(lang, {
      ...emptyGuideState(),
      confirmation: { code: "987654321", receivedAtMs: NOW - 9999, seenAtMs: NOW - 9999 },
    });
    expect(c.textContent).not.toContain("987654321");
  });

  test(`${lang}: code wait timed out offers a retry`, () => {
    const onChange = vi.fn();
    const c = render(lang, waiting(), { nowMs: NOW + TEST_WINDOW_MS, onChange });
    expect(c.textContent).toContain(g.gmail.step2TimedOut);
    click(byText("button", g.gmail.retryCode));
    expect(applied(onChange.mock.calls[0], waiting()).codeWaitStartedAtMs).toBe(
      NOW + TEST_WINDOW_MS,
    );
  });

  test(`${lang}: closed, the row shows one status per stage and no steps`, () => {
    const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(
      NOW - 1000,
    );
    const passed: GuideState = {
      ...emptyGuideState(),
      passedAtMs: NOW - 1000,
      test: {
        code: "k3x9",
        startedAtMs: NOW - 5000,
        receivedAtMs: NOW - 1000,
        receivedCode: "k3x9",
      },
    };
    const cases: [GuideState, number, string][] = [
      [emptyGuideState(), NOW, g.rowStatus["address-ready"]],
      [waiting(), NOW, g.rowStatus["waiting-for-code"]],
      [waiting(), NOW + TEST_WINDOW_MS, g.rowStatus["code-wait-timed-out"]],
      [
        waiting({ confirmation: { code: "123456789", receivedAtMs: NOW, seenAtMs: NOW } }),
        NOW,
        g.rowStatus["code-shown"],
      ],
      [startTest(emptyGuideState(), "k3x9", NOW - 1000), NOW, g.rowStatus["test-pending"]],
      [
        startTest(emptyGuideState(), "k3x9", NOW - TEST_WINDOW_MS - 1),
        NOW,
        g.rowStatus["test-timed-out"],
      ],
      [passed, NOW, g.rowPassed(time)],
    ];
    for (const [state, nowMs, text] of cases) {
      const c = render(lang, state, { nowMs, open: false });
      expect(c.querySelector('section > div [role="status"]')?.textContent, text).toBe(text);
      expect(dialog().open).toBe(false);
      expect(c.querySelector("section > div > button")?.textContent).toBe(g.openButton);
    }
    const none = render(lang, emptyGuideState(), { address: "", open: false });
    expect(none.querySelector('section > div [role="status"]')?.textContent).toBe(
      g.rowStatus["no-address"],
    );
  });

  test(`${lang}: the row surfaces an unreadable setup mail, the dismiss stays in the modal`, () => {
    const unread = { ...emptyGuideState(), setupUnreadable: 1 };
    const c = render(lang, unread, { open: false });
    const row = c.querySelector('section > div [role="status"]')!;
    expect(row.textContent).toContain(g.setupUnreadable.message);
    expect(row.className).toContain("text-warn");
    expect(c.textContent).not.toContain(g.setupUnreadable.dismiss);
    openModal();
    expect(dialog().textContent).toContain(g.setupUnreadable.dismiss);
  });

  test(`${lang}: a code fetched before the modal opens is adopted, shown in the row, and not stale`, () => {
    const fetched = {
      ...emptyGuideState(),
      confirmation: { code: "424242", receivedAtMs: NOW - 5000, seenAtMs: NOW - 5000 },
    };
    const c = render(lang, fetched, { open: false });
    expect(c.querySelector('section > div [role="status"]')?.textContent).toBe(
      g.rowStatus["code-shown"],
    );
    const onChange = vi.fn();
    render(lang, fetched, { open: false, onChange });
    openModal();
    const next = applied(onChange.mock.calls[0], fetched);
    expect(next.codeWaitStartedAtMs).toBe(NOW - 5000);
    expect(codeStatus(next, NOW)).toBe("received");
    // an old confirmation is not adopted: a fresh wait starts
    const old = {
      ...fetched,
      confirmation: { code: "1", receivedAtMs: 0, seenAtMs: NOW - TEST_WINDOW_MS - 1 },
    };
    const onChange2 = vi.fn();
    render(lang, old, { open: false, onChange: onChange2 });
    openModal();
    expect(applied(onChange2.mock.calls[0], old).codeWaitStartedAtMs).toBe(NOW);
  });

  test(`${lang}: the button opens a named modal with the full guide; closed it holds nothing`, () => {
    const c = render(lang, emptyGuideState(), { open: false });
    expect(dialog().open).toBe(false);
    expect(c.textContent).not.toContain(g.gmail.openSettings);
    openModal();
    expect(dialog().open).toBe(true);
    expect(dialog().getAttribute("aria-label")).toBe(g.ariaLabel);
    expect(c.querySelector("section")?.hasAttribute("aria-label")).toBe(false);
    // a click on the padding is not a backdrop click
    click(dialog().querySelector<HTMLElement>(".guide-dialog-body")!);
    expect(dialog().open).toBe(true);
    expect(dialog().textContent).toContain(g.gmail.openSettings);
    expect(dialog().querySelector('[role="tablist"]')).not.toBeNull();
  });

  test(`${lang}: Esc and the close button close it and focus returns to the opener`, () => {
    const c = render(lang, emptyGuideState());
    expect(dialog().open).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    act(() => {
      dialog().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(opener());
    openModal();
    expect(dialog().open).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    click(c.querySelector<HTMLElement>(`button[aria-label="${g.closeButton}"]`)!);
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(opener());
  });

  test(`${lang}: opening on the Gmail tab starts the code wait, on Outlook it does not`, () => {
    const onChange = vi.fn();
    render(lang, emptyGuideState(), { onChange, open: false });
    expect(onChange).not.toHaveBeenCalled();
    openModal();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(applied(onChange.mock.calls[0], emptyGuideState()).codeWaitStartedAtMs).toBe(NOW);
    const onChange2 = vi.fn();
    render(lang, setTab(emptyGuideState(), "outlook"), { onChange: onChange2 });
    expect(onChange2).not.toHaveBeenCalled();
  });

  test(`${lang}: test pending shows the subject and no start button`, () => {
    const c = render(lang, startTest(emptyGuideState(), "k3x9", NOW - 1000));
    expect(c.textContent).toContain(g.test.pending);
    expect(c.textContent).toContain(testSubject("k3x9", lang));
    expect(c.textContent).not.toContain(g.test.startButton);
  });

  test(`${lang}: test start button calls onStartTest`, () => {
    const onStartTest = vi.fn();
    render(lang, emptyGuideState(), { onStartTest });
    click(byText("button", g.test.startButton));
    expect(onStartTest).toHaveBeenCalledTimes(1);
  });

  test(`${lang}: passed with another code says so`, () => {
    const c = render(lang, {
      ...emptyGuideState(),
      passedAtMs: NOW - 1000,
      test: {
        code: "k3x9",
        startedAtMs: NOW - 5000,
        receivedAtMs: NOW - 1000,
        receivedCode: "zzzz",
      },
    });
    const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(
      NOW - 1000,
    );
    expect(c.textContent).toContain(g.test.passedOtherCode(time));
    expect(c.textContent).toContain(g.test.againButton);
  });

  test(`${lang}: timed-out test shows the checklist for the current tab only`, () => {
    const timedOut = startTest(emptyGuideState(), "k3x9", NOW - TEST_WINDOW_MS - 1);
    let c = render(lang, timedOut);
    expect(c.textContent).toContain(g.test.timedOut);
    for (const item of g.test.checklist) expect(c.textContent).toContain(item);
    expect(c.textContent).toContain(g.test.checklistGmail);
    expect(c.textContent).not.toContain(g.test.checklistOutlook);
    c = render(lang, setTab(timedOut, "outlook"));
    for (const item of g.test.checklist) expect(c.textContent).toContain(item);
    expect(c.textContent).toContain(g.test.checklistOutlook);
    expect(c.textContent).not.toContain(g.test.checklistGmail);
  });

  test(`${lang}: outlook tab shows the rule words, the work note and both links`, () => {
    const c = render(lang, setTab(emptyGuideState(), "outlook"));
    expect(c.textContent).toContain(g.outlook.step2(RULE_WORDS));
    expect(c.textContent).toContain("factuur, invoice");
    expect(c.querySelector('[role="note"]')?.textContent).toContain(g.outlook.workNote);
    for (const url of [OUTLOOK_COM_RULES_URL, OUTLOOK_WORK_RULES_URL]) {
      const a = c.querySelector<HTMLAnchorElement>(`a[href="${url}"]`);
      expect(a, url).not.toBeNull();
      expect(a!.target).toBe("_blank");
      expect(a!.rel).toBe("noopener noreferrer");
    }
    expect(c.textContent).not.toContain(g.gmail.step2Warn);
  });

  test(`${lang}: gmail links, filter query and its copy button`, async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const c = render(lang, emptyGuideState());
    for (const url of [GMAIL_FORWARDING_URL, GMAIL_FILTERS_URL]) {
      const a = c.querySelector<HTMLAnchorElement>(`a[href="${url}"]`);
      expect(a, url).not.toBeNull();
      expect(a!.target).toBe("_blank");
      expect(a!.rel).toBe("noopener noreferrer");
    }
    expect(c.textContent).toContain(GMAIL_FILTER_QUERY);
    expect(c.textContent).toContain(g.gmail.multiAccountNote);
    await act(async () => {
      byText("button", g.gmail.copyQuery).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith(GMAIL_FILTER_QUERY);
    expect(c.textContent).toContain(g.gmail.queryCopied);
  });

  test(`${lang}: tab choice and ticks go through onChange`, () => {
    const onChange = vi.fn();
    const c = render(lang, waiting(), { onChange });
    click(byText('[role="tab"]', g.tabOutlook));
    expect(applied(onChange.mock.calls[0], waiting()).tab).toBe("outlook");
    const box = c.querySelector<HTMLInputElement>(`input[aria-label="${g.stepDoneAria(3)}"]`)!;
    click(box);
    expect(applied(onChange.mock.calls[1], waiting()).ticks).toContain("gmail:3");
  });

  test(`${lang}: ticking step 1 keeps a running code wait so an early code is not stale`, () => {
    const onChange = vi.fn();
    const state = waiting({ ticks: [], codeWaitStartedAtMs: NOW - 5000 });
    const c = render(lang, state, { onChange, nowMs: NOW });
    click(c.querySelector<HTMLInputElement>(`input[aria-label="${g.stepDoneAria(1)}"]`)!);
    const next = applied(onChange.mock.calls.at(-1)!, state);
    expect(next.ticks).toContain("gmail:1");
    expect(next.codeWaitStartedAtMs).toBe(NOW - 5000);
  });

  test(`${lang}: opening the forwarding settings link starts the wait if none runs`, () => {
    const onChange = vi.fn();
    const idle = waiting({ codeWaitStartedAtMs: null });
    const c = render(lang, idle, { onChange });
    onChange.mockClear();
    click(c.querySelector<HTMLElement>(`a[href="${GMAIL_FORWARDING_URL}"]`)!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(applied(onChange.mock.calls[0], idle).codeWaitStartedAtMs).toBe(NOW);
  });

  test(`${lang}: unreadable setup mail shows a dismissable notice`, () => {
    const onChange = vi.fn();
    const unread = { ...emptyGuideState(), setupUnreadable: 2 };
    const c = render(lang, unread, { onChange });
    expect(c.textContent).toContain(g.setupUnreadable.message);
    click(byText("button", g.setupUnreadable.dismiss));
    expect(applied(onChange.mock.calls.at(-1)!, unread).setupUnreadable).toBe(0);
    const clean = render(lang, emptyGuideState());
    expect(clean.textContent).not.toContain(g.setupUnreadable.message);
  });
}

test("poll interval constant is 20 s (the Facturen polling effect uses it)", () => {
  expect(TEST_POLL_MS).toBe(20_000);
});

test("the #forwarding-guide anchor opens the modal once and is cleared", () => {
  window.history.replaceState(null, "", `${window.location.pathname}#forwarding-guide`);
  const onChange = vi.fn();
  const c = render("nl", emptyGuideState(), { open: false, onChange });
  expect(c.querySelector("#forwarding-guide")).not.toBeNull();
  expect(dialog().open).toBe(true);
  expect(window.location.hash).toBe("");
  // arriving on the Gmail tab counts as the Gmail steps being shown
  expect(onChange).toHaveBeenCalledTimes(1);
});

test("the wait-start updater never overwrites a code a fetch committed meanwhile", () => {
  const onChange = vi.fn();
  render("nl", emptyGuideState(), { onChange });
  const updater = onChange.mock.calls[0][0] as (p: GuideState) => GuideState;
  // By the time the owner applies it, a fetch has already started the wait and
  // delivered the code.
  const fetched = waiting({
    codeWaitStartedAtMs: NOW - 2000,
    confirmation: { code: "424242", receivedAtMs: NOW, seenAtMs: NOW - 1000 },
  });
  const out = updater(fetched);
  expect(out).toBe(fetched);
  expect(out.confirmation?.code).toBe("424242");
});
