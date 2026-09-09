"use client";

import { motion } from "framer-motion";
import { CalendarDays, Check } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/date-utils";
import { motion as motionTokens } from "@/lib/motion";
import {
  summarizeSyllabusMatches,
  type SyllabusMatch,
  type SyllabusRowDecision,
} from "@/lib/syllabus-match";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  homework: "Homework",
  quiz: "Quiz",
  exam: "Exam",
  paper: "Paper",
  lab: "Lab",
  project: "Project",
  discussion: "Discussion",
};

function dueLabel(at: string, clock24h: boolean): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const day = format(d, "EEE, MMM d");
  if (d.getHours() === 23 && d.getMinutes() === 59) return day;
  return `${day} · ${formatTime(at, clock24h)}`;
}

function isChecked(decision: SyllabusRowDecision): boolean {
  return decision === "import";
}

/** Review sheet for a parsed syllabus. Opt-out on new rows; matches stay off. */
export function SyllabusPreview({
  classLabel,
  warning,
  matches,
  decisions,
  clock24h,
  onToggle,
  onCancel,
  onConfirm,
}: {
  classLabel: string;
  warning?: string;
  matches: SyllabusMatch[];
  decisions: SyllabusRowDecision[];
  clock24h: boolean;
  onToggle: (index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { newCount, alreadyCount, checkCount } = summarizeSyllabusMatches(matches);
  const addCount = matches.reduce((n, m, i) => {
    if (decisions[i] !== "import") return n;
    if (m.verdict === "matched") return n;
    return n + 1;
  }, 0);
  const canApply = addCount > 0 || decisions.some((d) => d === "link");

  const summary = [
    `${newCount} new`,
    alreadyCount ? `${alreadyCount} already on your calendar` : null,
    checkCount ? `${checkCount} to check` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const newItems = indexed(matches, decisions, "new");
  const already = indexed(matches, decisions, "matched");
  const check = indexed(matches, decisions, "uncertain");

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{
        opacity: 0,
        y: -6,
        scale: 0.98,
        transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
      }}
      transition={motionTokens.spring}
      style={{ transformOrigin: "top center" }}
      className="flex max-h-[min(60dvh,28rem)] flex-col overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div className="flex shrink-0 flex-col gap-0.5 border-b border-line/60 px-4 py-3">
        <p className="truncate text-[13.5px] font-semibold text-ink">{classLabel}</p>
        <p className="text-[12px] text-ink-faint">{summary}</p>
        {warning && <p className="pt-1 text-[12.5px] leading-snug text-warn">{warning}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2">
        {newItems.length > 0 && (
          <Section label="New">
            {newItems.map((row) => (
              <PreviewRow
                key={`new-${row.index}`}
                match={row.match}
                checked={isChecked(row.decision)}
                clock24h={clock24h}
                onToggle={() => onToggle(row.index)}
              />
            ))}
          </Section>
        )}
        {already.length > 0 && (
          <Section label="Already in Datebook">
            {already.map((row) => (
              <PreviewRow
                key={`already-${row.index}`}
                match={row.match}
                checked={isChecked(row.decision)}
                clock24h={clock24h}
                showExistingTitle
                onToggle={() => onToggle(row.index)}
              />
            ))}
          </Section>
        )}
        {check.length > 0 && (
          <Section label="Check these">
            {check.map((row) => (
              <PreviewRow
                key={`check-${row.index}`}
                match={row.match}
                checked={isChecked(row.decision)}
                clock24h={clock24h}
                showExistingTitle
                onToggle={() => onToggle(row.index)}
              />
            ))}
          </Section>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line/60 px-4 py-3">
        <Button variant="tertiary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirm} disabled={!canApply}>
          {addCount > 0 ? `Add ${addCount} to Datebook` : "Update Datebook"}
        </Button>
      </div>
    </motion.div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

function PreviewRow({
  match,
  checked,
  clock24h,
  showExistingTitle,
  onToggle,
}: {
  match: SyllabusMatch;
  checked: boolean;
  clock24h: boolean;
  showExistingTitle?: boolean;
  onToggle: () => void;
}) {
  const existingTitle = match.existing?.title?.trim();
  const showBoth =
    showExistingTitle && existingTitle && existingTitle !== match.draft.title;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        "flex min-h-11 w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
        "hover:bg-surface-sunken/70",
        !checked && "opacity-45"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
          checked ? "border-accent bg-accent text-accent-ink" : "border-line-strong"
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">
          {match.draft.title}
        </span>
        {showBoth && (
          <span className="mt-0.5 block truncate text-[12px] text-ink-faint">
            → {existingTitle}
          </span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-soft">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" strokeWidth={1.9} />
            {dueLabel(match.draft.at, clock24h)}
          </span>
          {match.draft.kind && KIND_LABEL[match.draft.kind] && (
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-ink-soft">
              {KIND_LABEL[match.draft.kind]}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function indexed(
  matches: SyllabusMatch[],
  decisions: SyllabusRowDecision[],
  verdict: SyllabusMatch["verdict"]
) {
  const rows: { index: number; match: SyllabusMatch; decision: SyllabusRowDecision }[] = [];
  matches.forEach((match, index) => {
    if (match.verdict !== verdict) return;
    rows.push({ index, match, decision: decisions[index] ?? "skip" });
  });
  return rows;
}
