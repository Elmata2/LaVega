import type { ReactNode } from "react";

/* A deliberately small markdown subset for agent chat replies: paragraphs,
 * headings-as-bold, bullet/numbered lists, bold/italic/bold-italic, and
 * inline code. Never uses dangerouslySetInnerHTML — every node below is a
 * React element or a plain text child, so a message can never inject real
 * markup, and any markdown punctuation that doesn't form a valid pair is
 * dropped rather than shown literally. */

type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

const HEADING = /^#+\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+\.\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) blocks.push({ type: "paragraph", lines: paragraphLines });
    paragraphLines = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flushParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.items.push(bullet[1]);
      else blocks.push({ type: "ul", items: [bullet[1]] });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.type === "ol") last.items.push(ordered[1]);
      else blocks.push({ type: "ol", items: [ordered[1]] });
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraph();
  return blocks;
}

/* An emphasis delimiter only counts when it isn't touching whitespace on
 * its inner side (the standard "no space inside the delimiter" rule) —
 * without it, "shares * price" reads the lone asterisk as the start of an
 * italic span search instead of a literal character. */
function touchesWhitespace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/* Scans inline text for bold/italic/bold-italic/code spans, recursing into
 * each span's own contents so nesting (e.g. bold containing code) works.
 * A backtick run with no closing pair is dropped, since a stray backtick
 * is rare and never load-bearing punctuation. An asterisk run that never
 * finds a valid closing pair (no partner, or the only candidate touches
 * whitespace) is kept as literal asterisk characters instead of being
 * silently deleted, so a real "3 * 4" or a trailing footnote marker still
 * reaches the reader. A stray `#` is left alone: it is legitimate text far
 * more often than it is broken heading syntax (only a line-leading run of
 * `#` followed by a space is treated as heading markup, at the block
 * level). */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  let key = 0;

  const flushPlain = () => {
    if (plain) {
      nodes.push(plain);
      plain = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flushPlain();
        nodes.push(<code key={`c${key++}`}>{text.slice(i + 1, close)}</code>);
        i = close + 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "*") {
      let run = 1;
      while (text[i + run] === "*") run += 1;

      if (run >= 3 && !touchesWhitespace(text[i + 3])) {
        const close = text.indexOf("***", i + 3);
        if (close !== -1 && !touchesWhitespace(text[close - 1])) {
          flushPlain();
          nodes.push(
            <strong key={`bi${key++}`}>
              <em>{renderInline(text.slice(i + 3, close))}</em>
            </strong>,
          );
          i = close + 3;
          continue;
        }
      }

      if (run >= 2 && !touchesWhitespace(text[i + 2])) {
        const close = text.indexOf("**", i + 2);
        if (close !== -1 && !touchesWhitespace(text[close - 1])) {
          flushPlain();
          nodes.push(<strong key={`b${key++}`}>{renderInline(text.slice(i + 2, close))}</strong>);
          i = close + 2;
          continue;
        }
      }

      if (run === 1 && !touchesWhitespace(text[i + 1])) {
        const close = text.indexOf("*", i + 1);
        if (close !== -1 && !touchesWhitespace(text[close - 1])) {
          flushPlain();
          nodes.push(<em key={`i${key++}`}>{renderInline(text.slice(i + 1, close))}</em>);
          i = close + 1;
          continue;
        }
      }

      /* No valid closing marker at any length: keep the run as literal
       * asterisk characters instead of dropping it. */
      plain += "*".repeat(run);
      i += run;
      continue;
    }

    plain += ch;
    i += 1;
  }
  flushPlain();
  return nodes;
}

export function AgentMessageText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "heading")
          return (
            <p key={index} className="font-semibold">
              {renderInline(block.text)}
            </p>
          );
        if (block.type === "ul")
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        if (block.type === "ol")
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {renderInline(line)}
                {lineIndex < block.lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
