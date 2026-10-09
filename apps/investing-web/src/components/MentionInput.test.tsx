// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { MentionInput, MentionText } from "./MentionInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => document.body.replaceChildren());

const agents = [
  { id: "warren_buffett", displayName: "Warren Buffett" },
  { id: "charlie_munger", displayName: "Charlie Munger" },
  { id: "ben_graham", displayName: "Ben Graham" },
];

function Harness({ onSubmit }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <MentionInput value={value} onChange={setValue} agents={agents} selfId="charlie_munger" />
    </form>
  );
}

function render(onSubmit?: () => void) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => createRoot(container).render(<Harness onSubmit={onSubmit} />));
  return container.querySelector("textarea")!;
}

function type(input: HTMLTextAreaElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLTextAreaElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    input.dispatchEvent(event);
  });
  return event;
}

const options = () =>
  [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);

test("typing @ lists the other agents, never the one in the chat", () => {
  const input = render();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  type(input, "@");
  expect(options()).toEqual(["Warren Buffett", "Ben Graham"]);
  expect(input.getAttribute("role")).toBe("combobox");
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(input.getAttribute("aria-controls")).toBe(document.querySelector("ul")!.id);
});

test("the list narrows to names with a word starting with what follows the @", () => {
  const input = render();
  type(input, "hi @gra");
  expect(options()).toEqual(["Ben Graham"]);
  type(input, "hi @warren b");
  expect(options()).toEqual(["Warren Buffett"]);
  type(input, "hi @zzz");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

test("an @ inside a word, such as an email address, opens nothing", () => {
  const input = render();
  type(input, "mail a@");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

test("arrow keys move the highlight and Enter inserts the name without submitting", () => {
  const submit = vi.fn();
  const input = render(submit);
  type(input, "ask @");
  press(input, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBe(
    document.querySelectorAll('[role="option"]')[1]!.id,
  );
  const enter = press(input, "Enter");
  expect(enter.defaultPrevented).toBe(true);
  expect(input.value).toBe("ask @Ben Graham ");
  expect(input.selectionStart).toBe("ask @Ben Graham ".length);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

test("Tab and a click also choose", () => {
  const input = render();
  type(input, "@war");
  press(input, "Tab");
  expect(input.value).toBe("@Warren Buffett ");

  type(input, "@");
  act(() => {
    document
      .querySelector('[role="option"]')!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
  expect(input.value).toBe("@Warren Buffett ");
});

test("Escape closes the list, and Enter then sends the form", () => {
  const submit = vi.fn();
  const input = render(submit);
  type(input, "@");
  press(input, "Escape");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  const enter = press(input, "Enter");
  expect(enter.defaultPrevented).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
});

test("Shift+Enter starts a new line instead of sending", () => {
  const submit = vi.fn();
  const input = render(submit);
  type(input, "line one");
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    input.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

test("MentionText sets only whole agent names in bold", () => {
  const container = document.createElement("div");
  document.body.append(container);
  act(() =>
    createRoot(container).render(
      <MentionText text="@warren buffett and @Ben Grahamish, a@Ben Graham" agents={agents} />,
    ),
  );
  expect([...container.querySelectorAll("span")].map((span) => span.textContent)).toEqual([
    "@warren buffett",
  ]);
});
