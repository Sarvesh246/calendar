"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, FileText, Loader2 } from "lucide-react";
import { SyllabusPreview } from "@/components/syllabus-preview";
import { MAX_SYLLABUS_PDF_BYTES } from "@/lib/api-guard";
import { authBearerHeaders } from "@/lib/auth-headers";
import { wallTimeInZoneToIso } from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import {
  defaultSyllabusDecision,
  isSyllabusSource,
  matchSyllabusItems,
  resolveSyllabusCourse,
  syllabusSourceUrl,
  type SyllabusDraft,
  type SyllabusMatch,
  type SyllabusRowDecision,
} from "@/lib/syllabus-match";
import type {
  SyllabusExtractedItem,
  SyllabusExtractError,
  SyllabusExtractResult,
} from "@/lib/syllabus-extract";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

type Origin = { type: "shared" } | { type: "category"; id: string };

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

type PreviewState = {
  origin: Origin;
  fileName: string;
  classLabel: string;
  warning?: string;
  courseName: string;
  courseCode: string;
  forceCategoryId?: string;
  timeZone: string;
  drafts: SyllabusDraft[];
  matches: SyllabusMatch[];
  decisions: SyllabusRowDecision[];
};

type SyllabusImportContextValue = {
  origin: Origin | null;
  status: Status;
  preview: PreviewState | null;
  busy: boolean;
  pickFile: (file: File, origin: Origin) => void;
  toggleDecision: (index: number) => void;
  cancelPreview: () => void;
  confirmPreview: () => void;
};

const SyllabusImportContext = createContext<SyllabusImportContextValue | null>(null);

const EXTRACT_ERRORS = new Set<string>([
  "assistant-not-configured",
  "assistant-busy",
  "assistant-unreachable",
  "forbidden",
  "rate-limited",
  "payload-too-large",
  "bad-request",
  "missing-pdf",
  "invalid-pdf",
]);

const MAX_MB = (MAX_SYLLABUS_PDF_BYTES / (1024 * 1024)).toFixed(1);

function originKey(origin: Origin): string {
  return origin.type === "shared" ? "shared" : `cat:${origin.id}`;
}

function sameOrigin(a: Origin | null, b: Origin): boolean {
  return a !== null && originKey(a) === originKey(b);
}

export function SyllabusImportProvider({ children }: { children: React.ReactNode }) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pickFile = useCallback((file: File, nextOrigin: Origin) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOrigin(nextOrigin);
    setPreview(null);

    const tooBig = file.size > MAX_SYLLABUS_PDF_BYTES;
    if (tooBig) {
      setStatus({
        kind: "error",
        message: `That PDF is too large (max ${MAX_MB} MB).`,
      });
      return;
    }
    if (!looksLikePdf(file)) {
      setStatus({ kind: "error", message: "That file doesn't look like a PDF." });
      return;
    }

    setStatus({ kind: "loading" });
    void runExtract(file, nextOrigin, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.kind === "empty") {
          setPreview(null);
          setStatus({ kind: "success", message: next.message });
          return;
        }
        setPreview(next.preview);
        setStatus({ kind: "idle" });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setPreview(null);
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't read that syllabus.",
        });
      });
  }, []);

  const toggleDecision = useCallback((index: number) => {
    setPreview((current) => {
      if (!current || index < 0 || index >= current.decisions.length) return current;
      const verdict = current.matches[index]?.verdict ?? "new";
      const next = [...current.decisions];
      const cur = next[index];
      if (verdict === "matched") next[index] = cur === "link" ? "import" : "link";
      else next[index] = cur === "import" ? "skip" : "import";
      return { ...current, decisions: next };
    });
  }, []);

  const cancelPreview = useCallback(() => {
    abortRef.current?.abort();
    setPreview(null);
    setStatus({ kind: "idle" });
  }, []);

  const confirmPreview = useCallback(() => {
    const current = preview;
    if (!current) return;
    const result = useDatebookStore.getState().applySyllabusImport({
      drafts: current.drafts,
      timeZone: current.timeZone,
      forceCategoryId: current.forceCategoryId,
      courseName: current.courseName,
      courseCode: current.courseCode,
      fileName: current.fileName,
      decisions: current.decisions,
    });
    haptic("success");
    setPreview(null);
    setStatus({ kind: "success", message: summarizeApply(result.added, result.matched) });
  }, [preview]);

  const value = useMemo<SyllabusImportContextValue>(
    () => ({
      origin,
      status,
      preview,
      busy: status.kind === "loading",
      pickFile,
      toggleDecision,
      cancelPreview,
      confirmPreview,
    }),
    [origin, status, preview, pickFile, toggleDecision, cancelPreview, confirmPreview]
  );

  return (
    <SyllabusImportContext.Provider value={value}>
      <div className="contents">{children}</div>
    </SyllabusImportContext.Provider>
  );
}

function useSyllabusImport(): SyllabusImportContextValue {
  const ctx = useContext(SyllabusImportContext);
  if (!ctx) throw new Error("SyllabusImportProvider is required");
  return ctx;
}

/** Shared attach card under Settings → Import a calendar link. */
export function ImportSyllabus() {
  const { origin, status, preview, busy, pickFile, toggleDecision, cancelPreview, confirmPreview } =
    useSyllabusImport();
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);
  const mine = origin?.type === "shared";
  const showPreview = mine && preview;
  const showStatus =
    mine && (status.kind === "error" || status.kind === "success") && !showPreview;

  function onFiles(list: FileList | null) {
    const file = list?.[0];
    if (!file || busy) return;
    pickFile(file, { type: "shared" });
  }

  function onDragOver(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    if (!busy) setDragOver(true);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        id={inputId}
        type="file"
        accept="application/pdf"
        className="sr-only"
        aria-label="Syllabus PDF"
        disabled={busy}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <label
        htmlFor={inputId}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-11 cursor-pointer flex-col gap-2 rounded-lg border bg-surface px-3 py-2.5 sm:flex-row sm:items-center",
          dragOver ? "border-accent" : "border-line",
          busy && "pointer-events-none"
        )}
      >
        {busy && mine ? (
          <span className="flex min-h-11 items-center gap-2 text-[13.5px] text-ink-soft">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
            Reading syllabus…
          </span>
        ) : (
          <>
            <FileText className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-[13.5px] text-ink-faint">
              Drop a PDF or tap to choose
            </span>
            <span className="flex min-h-11 shrink-0 items-center justify-center rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
              Attach
            </span>
          </>
        )}
      </label>

      <StatusLine show={Boolean(showStatus)} status={status} />

      <AnimatePresence initial={false}>
        {showPreview && preview && (
          <SyllabusPreview
            key="syllabus-preview"
            classLabel={preview.classLabel}
            warning={preview.warning}
            matches={preview.matches}
            decisions={preview.decisions}
            clock24h={clock24h}
            onToggle={toggleDecision}
            onCancel={cancelPreview}
            onConfirm={confirmPreview}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Per-class control on a Settings category row. */
export function CategorySyllabusControl({ category }: { category: Category }) {
  const { origin, status, preview, busy, pickFile, toggleDecision, cancelPreview, confirmPreview } =
    useSyllabusImport();
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const sources = useDatebookStore((s) => s.importSources);
  const inputId = useId();
  const mineOrigin: Origin = { type: "category", id: category.id };
  const mine = sameOrigin(origin, mineOrigin);
  const showPreview = mine && preview;
  const showStatus = mine && (status.kind === "error" || status.kind === "success") && !showPreview;

  const source = sources.find(
    (s) => isSyllabusSource(s) && s.url === syllabusSourceUrl(category.name)
  );

  function onFiles(list: FileList | null) {
    const file = list?.[0];
    if (!file || busy) return;
    pickFile(file, mineOrigin);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        id={inputId}
        type="file"
        accept="application/pdf"
        className="sr-only"
        aria-label={`Syllabus PDF for ${category.name}`}
        disabled={busy}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <label
        htmlFor={inputId}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-0.5 text-left transition-colors",
          "hover:bg-surface-sunken/50",
          busy && "pointer-events-none"
        )}
      >
        {busy && mine ? (
          <span className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
            Reading syllabus…
          </span>
        ) : (
          <>
            <FileText
              className="h-3.5 w-3.5 shrink-0"
              strokeWidth={1.9}
              style={{ color: category.color }}
            />
            {source ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {source.name}
                </span>
                <span className="block truncate text-[11.5px] text-ink-faint">
                  {source.itemCount} from syllabus · tap to update
                </span>
              </span>
            ) : (
              <span className="text-[12.5px] font-medium text-ink-soft">Add syllabus</span>
            )}
          </>
        )}
      </label>

      <StatusLine show={Boolean(showStatus)} status={status} />

      <AnimatePresence initial={false}>
        {showPreview && preview && (
          <SyllabusPreview
            key="syllabus-preview"
            classLabel={preview.classLabel}
            warning={preview.warning}
            matches={preview.matches}
            decisions={preview.decisions}
            clock24h={clock24h}
            onToggle={toggleDecision}
            onCancel={cancelPreview}
            onConfirm={confirmPreview}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusLine({ show, status }: { show: boolean; status: Status }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {show && (status.kind === "error" || status.kind === "success") && (
        <motion.p
          key={status.kind + status.message}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
          className={cn(
            "flex items-start gap-1.5 text-[12.5px]",
            status.kind === "error" ? "text-warn" : "text-good"
          )}
        >
          {status.kind === "error" ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          )}
          {status.message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

async function runExtract(
  file: File,
  origin: Origin,
  signal: AbortSignal
): Promise<{ kind: "empty"; message: string } | { kind: "preview"; preview: PreviewState }> {
  const store = useDatebookStore.getState();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const forceCategoryId = origin.type === "category" ? origin.id : undefined;
  const extracted = await postSyllabusPdf(file, {
    timeZone,
    categoryId: forceCategoryId,
    categories: store.categories.map((c) => ({ id: c.id, name: c.name })),
    signal,
  });

  const fileName = file.name.split(/[/\\]/).pop() || file.name;
  if (extracted.items.length === 0) {
    return { kind: "empty", message: "No dated work found in this syllabus." };
  }

  const drafts = extracted.items.map((item) => extractedToDraft(item, timeZone));
  const resolved = resolveSyllabusCourse({
    categories: store.categories,
    courseName: extracted.courseName,
    courseCode: extracted.courseCode,
    forceCategoryId,
  });
  const classLabel =
    resolved.status === "create"
      ? resolved.name
      : store.categories.find((c) => c.id === resolved.categoryId)?.name ||
        extracted.courseName ||
        extracted.courseCode ||
        "Imported";
  const warning = resolved.status === "forced" ? resolved.warning : undefined;
  const matches = matchSyllabusItems(
    drafts,
    resolved.status === "create" ? [] : store.items,
    {
      timeZone,
      ...(resolved.status === "create" ? {} : { categoryId: resolved.categoryId }),
    }
  );
  const decisions = matches.map((m) => defaultSyllabusDecision(m.verdict));

  return {
    kind: "preview",
    preview: {
      origin,
      fileName,
      classLabel,
      warning,
      courseName: extracted.courseName,
      courseCode: extracted.courseCode,
      forceCategoryId,
      timeZone,
      drafts,
      matches,
      decisions,
    },
  };
}

function extractedToDraft(item: SyllabusExtractedItem, timeZone: string): SyllabusDraft {
  const time = parseDueTime(item.dueTime);
  const hour = time?.hour ?? 23;
  const minute = time?.minute ?? 59;
  return {
    title: item.title,
    at: wallTimeInZoneToIso(item.dueDate, hour, minute, timeZone),
    type: item.type,
    kind: item.kind,
    ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
  };
}

function parseDueTime(raw?: string): { hour: number; minute: number } | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return undefined;
  }
  return { hour, minute };
}

async function postSyllabusPdf(
  file: File,
  opts: {
    timeZone: string;
    categoryId?: string;
    categories: { id: string; name: string }[];
    signal: AbortSignal;
  }
): Promise<SyllabusExtractResult> {
  const form = new FormData();
  form.append("pdf", file, file.name);
  form.append("timeZone", opts.timeZone);
  form.append("now", new Date().toISOString());
  if (opts.categoryId) form.append("categoryId", opts.categoryId);
  form.append("categories", JSON.stringify(opts.categories));

  const res = await fetch("/api/import-syllabus", {
    method: "POST",
    headers: await authBearerHeaders(),
    body: form,
    signal: opts.signal,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(messageForExtractError(undefined, res.status));
  }

  const errorCode = extractErrorCode(data);
  if (errorCode) throw new Error(messageForExtractError(errorCode, res.status));
  if (!res.ok) throw new Error(messageForExtractError(undefined, res.status));

  const courseName = typeof (data as { courseName?: unknown }).courseName === "string"
    ? (data as { courseName: string }).courseName
    : "";
  const courseCode = typeof (data as { courseCode?: unknown }).courseCode === "string"
    ? (data as { courseCode: string }).courseCode
    : "";
  const items = Array.isArray((data as { items?: unknown }).items)
    ? ((data as { items: SyllabusExtractedItem[] }).items)
    : [];
  return { courseName, courseCode, items };
}

function extractErrorCode(data: unknown): SyllabusExtractError | undefined {
  if (!data || typeof data !== "object" || !("error" in data)) return undefined;
  const code = (data as { error: unknown }).error;
  if (typeof code === "string" && EXTRACT_ERRORS.has(code)) return code as SyllabusExtractError;
  return undefined;
}

function messageForExtractError(code: string | undefined, status: number): string {
  if (code === "assistant-not-configured") return "Syllabus reading isn't set up on this server.";
  if (code === "assistant-busy") return "The reader is busy — try again in a moment.";
  if (code === "assistant-unreachable") return "Couldn't reach the syllabus reader. Try again.";
  if (code === "forbidden" || status === 403) return "This request was blocked.";
  if (code === "rate-limited" || status === 429) return "Too many syllabus reads — try again in a bit.";
  if (code === "payload-too-large" || status === 413) {
    return `That PDF is too large (max ${MAX_MB} MB).`;
  }
  if (code === "missing-pdf") return "Choose a PDF to import.";
  if (code === "invalid-pdf") return "That file doesn't look like a PDF.";
  if (code === "bad-request") return "Couldn't read that syllabus.";
  return "Couldn't read that syllabus.";
}

function looksLikePdf(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const named = file.name.toLowerCase().endsWith(".pdf");
  if (type === "application/pdf") return true;
  if (type === "application/octet-stream" || type === "") return named;
  return false;
}

function summarizeApply(added: number, matched: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (matched) parts.push(`${matched} already on your calendar`);
  return parts.length ? parts.join(" · ") : "Already up to date.";
}
