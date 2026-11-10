import { findAdviceLanguage } from "@lavega/core";
import { builtHubs, counterpart, urlFor, type Page } from "./content";

export type Finding = { file: string; rule: string; detail: string };

export const DISCLAIMER = {
  nl: "Dit is informatie, geen advies.",
  en: "This is information, not advice.",
} as const;

const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

function withoutLinkTargets(text: string): string {
  return text.replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, " ");
}

function fields(p: Page): [string, string][] {
  return [
    ["title", p.title],
    ["description", p.description],
    ["body", p.bodyMarkdown],
    ...p.faq.flatMap((f, i): [string, string][] => [
      [`faq[${i}].q`, f.q],
      [`faq[${i}].a`, f.a],
    ]),
  ];
}

const ROUTES = new Set(["/", "/en"]);

/** Root-relative link targets in Markdown `](/path)`, without query or fragment. */
function internalLinks(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/\]\(\s*(\/(?!\/)[^)\s]*)/g)) {
    const path = (m[1] ?? "").split(/[?#]/)[0] ?? "";
    out.push(path.length > 1 ? path.replace(/\/+$/, "") : path);
  }
  return out;
}

export function checkPages(pages: Page[]): Finding[] {
  const out: Finding[] = [];
  const live = pages.filter((x) => x.status === "published");
  const urls = new Set(live.map(urlFor));
  const hubs = builtHubs(live);
  for (const p of pages) {
    const add = (rule: string, detail: string) => out.push({ file: p.file, rule, detail });

    for (const [field, text] of fields(p)) {
      const hits = findAdviceLanguage(withoutLinkTargets(text), p.locale);
      if (hits.length) add("advice", `${hits.join(", ")} in ${field}`);
    }

    const len = p.description.length;
    if (len < DESCRIPTION_MIN || len > DESCRIPTION_MAX)
      add("description-length", `${len} chars, want ${DESCRIPTION_MIN}-${DESCRIPTION_MAX}`);

    if (!p.bodyMarkdown.includes(DISCLAIMER[p.locale]))
      add("disclaimer", `body lacks "${DISCLAIMER[p.locale]}"`);

    if (p.family !== "over" && p.sources.length === 0) add("sources", "needs at least one source");

    if (/^# /m.test(p.bodyMarkdown) || /<h1[\s>]/i.test(p.bodyMarkdown))
      add("no-h1", "body must not contain an h1; the title is the h1");

    if (p.bodyMarkdown.includes("[[TODO")) add("todo", "body contains [[TODO");

    if (p.status === "published") {
      for (const target of new Set(internalLinks(p.bodyMarkdown)))
        if (!ROUTES.has(target) && !urls.has(target) && !hubs.has(target))
          add("link", `${target} is not a published page, a built hub, / or /en`);
    }

    const other = counterpart(p, pages);
    if (other && other.family !== p.family)
      add("counterpart", `${other.file} is family ${other.family}, expected ${p.family}`);
  }
  return out;
}
