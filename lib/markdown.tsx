import { Fragment, type ReactNode } from "react";
import { cn } from "./utils";

/**
 * Tiny Markdown renderer for the assistant's chat replies. Deliberately narrow —
 * `**bold**`, `*italic*` / `_italic_`, `` `code` ``, `[label](url)`, `- ` / `1. `
 * lists, blank-line paragraphs, and single line breaks. Builds React nodes (no
 * `dangerouslySetInnerHTML`), so LLM output can't inject markup.
 */

const INLINE_RE =
  /(\*\*([^*]+?)\*\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\))|(\*([^*\n]+?)\*)|(_([^_\n]+?)_)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] != null) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {m[2]}
        </strong>
      );
    } else if (m[4] != null) {
      out.push(
        <code
          key={key}
          className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink"
        >
          {m[4]}
        </code>
      );
    } else if (m[6] != null && m[7] != null) {
      out.push(
        <a
          key={key}
          href={m[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline decoration-accent/40 underline-offset-2"
        >
          {m[6]}
        </a>
      );
    } else if (m[9] != null) {
      out.push(<em key={key}>{m[9]}</em>);
    } else if (m[11] != null) {
      out.push(<em key={key}>{m[11]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^\s*#+\s*/, "")); // strip stray heading marks
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export function AssistantMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn("space-y-2 text-[13px] leading-relaxed text-ink", className)}>
      {blocks.map((b, bi) =>
        b.kind === "p" ? (
          <p key={bi}>
            {b.lines.map((ln, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(ln, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        ) : b.ordered ? (
          <ol key={bi} className="ml-4 list-decimal space-y-1 marker:text-ink-faint">
            {b.items.map((it, li) => (
              <li key={li}>{renderInline(it, `${bi}-${li}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={bi} className="ml-4 list-disc space-y-1 marker:text-ink-faint">
            {b.items.map((it, li) => (
              <li key={li}>{renderInline(it, `${bi}-${li}`)}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
