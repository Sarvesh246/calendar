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
import { authBearerHeaders } from "@/lib/auth-headers";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import {
  defaultSyllabusDecision,
  findSyllabusSource,
  matchSyllabusItems,
  resolveSyllabusCourse,
  toggleSyllabusRowDecision,
  type SyllabusDraft,
  type SyllabusMatch,
  type SyllabusRowDecision,
} from "@/lib/syllabus-match";
import {
  extractedItemToDraft,
  looksLikeSyllabusPdf,
  MAX_SYLLABUS_PDF_BYTES,
  retrySyllabusExtractOnce,
  SyllabusExtractRequestError,
  syllabusErrorFromResponse,
  type SyllabusExtractedItem,
  type SyllabusExtractResult,
} from "@/lib/syllabus-extract";
import { SYLLABUS_CLIENT_RETRY_MS } from "@/lib/syllabus-limits";
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
    if (!looksLikeSyllabusPdf(file)) {
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
        const message =
          err instanceof SyllabusExtractRequestError
            ? err.message
            : err instanceof Error && err.name === "AbortError"
              ? "Couldn't reach the syllabus reader. Try again."
              : err instanceof Error
                ? err.message
                : "Couldn't read that syllabus.";
        setStatus({ kind: "error", message });
      });
  }, []);

  const toggleDecision = useCallback((index: number) => {
    setPreview((current) => {
      if (!current || index < 0 || index >= current.decisions.length) return current;
      const verdict = current.matches[index]?.verdict ?? "new";
      const next = [...current.decisions];
      next[index] = toggleSyllabusRowDecision(next[index], verdict);
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
  const items = useDatebookStore((s) => s.items);
  const inputId = useId();
  const mineOrigin: Origin = { type: "category", id: category.id };
  const mine = sameOrigin(origin, mineOrigin);
  const showPreview = mine && preview;
  const showStatus = mine && (status.kind === "error" || status.kind === "success") && !showPreview;

  const source = findSyllabusSource(category, sources, items);

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

  const drafts = extracted.items.map((item) => extractedItemToDraft(item, timeZone));
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

async function postSyllabusPdf(
  file: File,
  opts: {
    timeZone: string;
    categoryId?: string;
    categories: { id: string; name: string }[];
    signal: AbortSignal;
  }
): Promise<SyllabusExtractResult> {
  return retrySyllabusExtractOnce(() => postSyllabusPdfOnce(file, opts), {
    signal: opts.signal,
    delayMs: SYLLABUS_CLIENT_RETRY_MS,
  });
}

async function postSyllabusPdfOnce(
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

  let res: Response;
  try {
    res = await fetch("/api/import-syllabus", {
      method: "POST",
      headers: await authBearerHeaders(),
      body: form,
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal.aborted) throw err;
    throw new SyllabusExtractRequestError("assistant-unreachable", 0);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    const code =
      syllabusErrorFromResponse(undefined, res.status) ??
      (res.ok ? undefined : "assistant-unreachable");
    if (code) throw new SyllabusExtractRequestError(code, res.status);
    throw new SyllabusExtractRequestError("bad-request", res.status);
  }

  const rawCode =
    data && typeof data === "object" && "error" in data
      ? (data as { error: unknown }).error
      : undefined;
  const errorCode = syllabusErrorFromResponse(rawCode, res.status);
  if (errorCode) throw new SyllabusExtractRequestError(errorCode, res.status);
  if (!res.ok) throw new SyllabusExtractRequestError("assistant-unreachable", res.status);

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

function summarizeApply(added: number, matched: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (matched) parts.push(`${matched} already on your calendar`);
  return parts.length ? parts.join(" · ") : "Already up to date.";
}
