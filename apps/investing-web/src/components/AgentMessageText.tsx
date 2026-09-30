import type { ReactNode } from "react";

/* Every node below must be a real React element or text child — never
 * dangerouslySetInnerHTML — so an agent reply can never inject markup. */

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

/* "shares * price" must stay plain text, not read as an italic span, so a
 * delimiter only counts when its inner side isn't whitespace. */
function touchesWhitespace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/* Recurses into each matched span's own contents so nesting (e.g. bold
 * containing code) works. An asterisk run with no valid closing pair is
 * kept as literal characters, not dropped, so "3 * 4" and a trailing
 * footnote marker still reach the reader. */
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
