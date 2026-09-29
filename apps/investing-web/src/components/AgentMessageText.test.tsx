// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AgentMessageText } from "./AgentMessageText";

afterEach(() => document.body.replaceChildren());

function render(text: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AgentMessageText text={text} />);
  });
  return { container, root };
}

test("renders **bold** as a strong element with no literal asterisks", () => {
  const { container, root } = render("This is **bold** text.");
  const strong = container.querySelector("strong");
  expect(strong?.textContent).toBe("bold");
  expect(container.textContent).not.toContain("*");
  root.unmount();
});

test("renders ***bold-italic*** with both strong and em ancestry and no literal asterisks", () => {
  const { container, root } = render("***Examples***");
  const strong = container.querySelector("strong");
  const em = container.querySelector("strong em, em strong");
  expect(strong?.textContent).toBe("Examples");
  expect(em?.textContent).toBe("Examples");
  expect(container.textContent).not.toContain("*");
  root.unmount();
});

test("renders a *italic* line as an em element", () => {
  const { container, root } = render("*italic*");
  const em = container.querySelector("em");
  expect(em?.textContent).toBe("italic");
  expect(container.textContent).not.toContain("*");
  root.unmount();
});

test("renders a heading line as visually bold, not an h1/h2/h3, with the hashes stripped", () => {
  const { container, root } = render("### Heading");
  expect(container.querySelector("h1, h2, h3")).toBeNull();
  const bold =
    container.querySelector("strong") ?? container.querySelector('[class*="font-semibold"]');
  expect(bold?.textContent).toBe("Heading");
  expect(container.textContent).not.toContain("#");
  root.unmount();
});

test("renders a bullet list as ul > li with no literal dash prefix", () => {
  const { container, root } = render("- a\n- b");
  const ul = container.querySelector("ul");
  const items = [...(ul?.querySelectorAll("li") ?? [])].map((node) => node.textContent);
  expect(items).toEqual(["a", "b"]);
  expect(container.textContent).not.toContain("-");
  root.unmount();
});

test("renders a numbered list as ol > li", () => {
  const { container, root } = render("1. a\n2. b");
  const ol = container.querySelector("ol");
  const items = [...(ol?.querySelectorAll("li") ?? [])].map((node) => node.textContent);
  expect(items).toEqual(["a", "b"]);
  root.unmount();
});

test("renders inline `code` as a code element", () => {
  const { container, root } = render("Run `x` now.");
  const code = container.querySelector("code");
  expect(code?.textContent).toBe("x");
  root.unmount();
});

test("a lone unmatched asterisk renders as plain visible text without crashing", () => {
  expect(() => render("This has a * lone star in it.")).not.toThrow();
  const { container, root } = render("This has a * lone star in it.");
  expect(container.textContent).not.toContain("*");
  expect(container.textContent).toContain("lone star");
  root.unmount();
});

test("unmatched ** with no closing pair renders as plain visible text without crashing", () => {
  expect(() => render("This is **broken markdown with no close")).not.toThrow();
  const { container, root } = render("This is **broken markdown with no close");
  expect(container.textContent).not.toContain("**");
  expect(container.textContent).toContain("broken markdown");
  root.unmount();
});

test("a literal <script> string never becomes a real script element and stays visible text", () => {
  const before = document.querySelectorAll("script").length;
  const { container, root } = render("<script>alert(1)</script>");
  expect(document.querySelectorAll("script").length).toBe(before);
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain("<script>alert(1)</script>");
  root.unmount();
});

test("does not turn a bare URL or markdown link syntax into a link", () => {
  const { container, root } = render("See [docs](https://example.com) or https://example.com");
  expect(container.querySelector("a")).toBeNull();
  expect(container.textContent).toContain("https://example.com");
  root.unmount();
});
