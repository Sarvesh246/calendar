import { Fragment, type ReactNode } from "react";
import { cn } from "./utils";
import { safeExternalUrl } from "./safe-url";

/**
 * Tiny Markdown renderer for the assistant's chat replies. Deliberately narrow —
 * `**bold**`, `*italic*` / `_italic_`, `` `code` ``, `[label](url)`, `- ` / `1. `
 * lists (one level of nesting), blank-line paragraphs, and single line breaks.
 * A pipe table is drawn as stacked rows, since a phone has no room for one.
 * Builds React nodes (no `dangerouslySetInnerHTML`), so LLM output can't inject
 * markup.
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
        </strong>,
      );
    } else if (m[4] != null) {
      out.push(
        <code
          key={key}
          className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink"
        >
          {m[4]}
        </code>,
      );
    } else if (m[6] != null && m[7] != null) {
      const href = safeExternalUrl(m[7]);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent underline decoration-accent/40 underline-offset-2"
          >
            {m[6]}
          </a>
        ) : (
          <span key={key}>{m[6]}</span>
        ),
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

/** A list item and, at most one level down, the items nested under it. */
export type ListItem = { text: string; sub?: { ordered: boolean; items: string[] } };
export type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  /** Rendered as stacked rows: a pipe table has no room on a phone. */
  | { kind: "table"; header: string[]; rows: string[][] };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line: string) => /^[\s|:-]+$/.test(line) && line.includes("-");

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  // Asserted, not annotated: the flush closures reassign these, which control
  // flow analysis cannot see, and would otherwise narrow them to `null`.
  let list = null as { ordered: boolean; items: ListItem[] } | null;
  let table = null as string[] | null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushTable = () => {
    if (table) {
      const rows = table.filter((l) => !isSeparator(l)).map(splitRow);
      if (rows.length >= 2) blocks.push({ kind: "table", header: rows[0], rows: rows.slice(1) });
      else para.push(...table);
    }
    table = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (isTableLine(line)) {
      flushPara();
      flushList();
      (table ??= []).push(line);
      continue;
    }
    flushTable();
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    const marker = bullet ?? numbered;
    if (marker) {
      flushPara();
      const ordered = !bullet;
      const current: { ordered: boolean; items: ListItem[] } | null = list;
      if (marker[1].length >= 2 && current && current.items.length > 0) {
        const parent = current.items[current.items.length - 1];
        parent.sub ??= { ordered, items: [] };
        parent.sub.items.push(marker[2]);
        continue;
      }
      if (!current || current.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list!.items.push({ text: marker[2] });
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^\s*#+\s*/, "")); // strip stray heading marks
    }
  }
  flushTable();
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
        ) : b.kind === "table" ? (
          <div key={bi} className="space-y-1.5">
            {b.rows.map((row, ri) => (
              <div key={ri} className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
                <p className="font-semibold text-ink">
                  {renderInline(row[0] ?? "", `${bi}-${ri}-0`)}
                </p>
                {row.slice(1).map((cell, ci) =>
                  cell ? (
                    <p key={ci} className="text-ink-soft">
                      {b.header[ci + 1] ? (
                        <span className="text-ink-faint">{b.header[ci + 1]}: </span>
                      ) : null}
                      {renderInline(cell, `${bi}-${ri}-${ci + 1}`)}
                    </p>
                  ) : null,
                )}
              </div>
            ))}
          </div>
        ) : (
          <ListBlock key={bi} block={b} base={`${bi}`} />
        ),
      )}
    </div>
  );
}

function ListBlock({ block, base }: { block: Extract<Block, { kind: "list" }>; base: string }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "ml-4 space-y-1 marker:text-ink-faint",
        block.ordered ? "list-decimal" : "list-disc",
      )}
    >
      {block.items.map((it, li) => (
        <li key={li}>
          {renderInline(it.text, `${base}-${li}`)}
          {it.sub && (
            <ul
              className={cn(
                "ml-4 mt-1 space-y-1 marker:text-ink-faint",
                it.sub.ordered ? "list-decimal" : "list-[circle]",
              )}
            >
              {it.sub.items.map((sub, si) => (
                <li key={si}>{renderInline(sub, `${base}-${li}-${si}`)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </Tag>
  );
}
