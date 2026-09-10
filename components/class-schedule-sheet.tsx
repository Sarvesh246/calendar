"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, X } from "lucide-react";
import { setHours, setMinutes } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { thisOrNextWeekday } from "@/lib/date-utils";
import { parseClassSchedule, scheduleRepeat } from "@/lib/class-schedule";
import { defaultUntilIso } from "@/lib/repeat";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WeekdayChips } from "@/components/weekday-chips";
import type { Day } from "date-fns";

export { WeekdayChips };

const FIELD =
  "w-full rounded-lg border border-line bg-surface-sunken/50 px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none";

export function ClassScheduleSheet() {
  const open = useUIStore((s) => s.classScheduleOpen);
  const presetCategoryId = useUIStore((s) => s.classScheduleCategoryId);
  const close = useUIStore((s) => s.closeClassSchedule);
  const allCategories = useDatebookStore((s) => s.categories);
  const categories = allCategories.filter((c) => !c.archived);
  const addItem = useDatebookStore((s) => s.addItem);
  const headingId = useId();

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("10:50");
  const [location, setLocation] = useState("");
  const [until, setUntil] = useState("");
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const first = presetCategoryId && categories.some((c) => c.id === presetCategoryId)
      ? presetCategoryId
      : categories[0]?.id ?? "";
    setCategoryId(first);
    setTitle(categories.find((c) => c.id === first)?.name ?? "");
    setDays([1, 3, 5]);
    setStart("10:00");
    setEnd("10:50");
    setLocation("");
    setUntil(defaultUntilIso().slice(0, 10));
    setPaste("");
    setError(null);
  }, [open, presetCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  function applyPaste() {
    const parsed = parseClassSchedule(paste, categories);
    if (!parsed) {
      setError("Couldn't read days and a time range from that.");
      return;
    }
    setError(null);
    setTitle(parsed.title);
    if (parsed.categoryId) setCategoryId(parsed.categoryId);
    setDays(parsed.days);
    setStart(`${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`);
    setEnd(`${String(parsed.endHour).padStart(2, "0")}:${String(parsed.endMinute).padStart(2, "0")}`);
    if (parsed.location) setLocation(parsed.location);
    if (parsed.until) setUntil(parsed.until.slice(0, 10));
    haptic("success");
  }

  function submit() {
    if (days.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(eh) || eh * 60 + em <= sh * 60 + sm) {
      setError("End time needs to be after the start.");
      return;
    }
    const cat = categoryId || categories[0]?.id;
    if (!cat) {
      setError("Add a class first.");
      return;
    }
    const day = days[0] as Day;
    const first = thisOrNextWeekday(day);
    const at = setMinutes(setHours(first, sh), sm);
    const endAt = setMinutes(setHours(first, eh), em);
    const untilIso = until ? new Date(`${until}T23:59:59`).toISOString() : defaultUntilIso();
    addItem({
      title: title.trim() || categories.find((c) => c.id === cat)?.name || "Class",
      type: "event",
      categoryId: cat,
      at: at.toISOString(),
      endAt: endAt.toISOString(),
      ...(location.trim() ? { location: location.trim() } : {}),
      repeat: scheduleRepeat(days, untilIso),
    });
    haptic("success");
    close();
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="viewport-pinned-overlay fixed inset-0 z-[60]">
          <motion.button
            type="button"
            aria-label="Dismiss"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="overlay-scrim absolute inset-0"
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={motionTokens.springGentle}
            className="absolute inset-x-3 top-[10vh] mx-auto flex max-h-[min(80dvh,640px)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface md:inset-x-auto md:left-1/2 md:top-[12vh] md:-translate-x-1/2"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
              <div>
                <p id={headingId} className="text-[16px] font-semibold text-ink">
                  Add class times
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-soft">
                  Repeats each week until the term ends.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
              <label className="block text-[12px] font-medium text-ink-faint">Paste or type</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyPaste()}
                  placeholder="ENGL 101 MWF 10:00–10:50"
                  className={FIELD}
                />
                <button
                  type="button"
                  onClick={applyPaste}
                  disabled={!paste.trim()}
                  className="shrink-0 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-soft hover:text-ink disabled:opacity-30"
                >
                  Read
                </button>
              </div>

              <label className="mt-4 block text-[12px] font-medium text-ink-faint">Class</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  const name = categories.find((c) => c.id === e.target.value)?.name;
                  if (name && (!title || title === categories.find((c) => c.id === categoryId)?.name)) {
                    setTitle(name);
                  }
                }}
                className={cn(FIELD, "mt-1.5")}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Lecture title"
                aria-label="Title"
                className={cn(FIELD, "mt-2")}
              />

              <p className="mt-4 text-[12px] font-medium text-ink-faint">Days</p>
              <div className="mt-1.5">
                <WeekdayChips value={days} onChange={setDays} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[12px] font-medium text-ink-faint">Starts</span>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className={cn(FIELD, "mt-1.5")}
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-ink-faint">Ends</span>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className={cn(FIELD, "mt-1.5")}
                  />
                </label>
              </div>

              <label className="mt-4 block text-[12px] font-medium text-ink-faint">Room</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Optional"
                className={cn(FIELD, "mt-1.5")}
              />

              <label className="mt-4 block text-[12px] font-medium text-ink-faint">Until</label>
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className={cn(FIELD, "mt-1.5")}
              />

              {error && <p className="mt-3 text-[12.5px] text-warn">{error}</p>}
            </div>

            <div className="flex shrink-0 gap-2 border-t border-line/70 px-4 py-3">
              <button
                type="button"
                onClick={close}
                className="min-h-11 flex-1 rounded-xl border border-line text-[13.5px] font-medium text-ink-soft hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-[13.5px] font-medium text-accent-ink"
              >
                <CalendarClock className="h-4 w-4" strokeWidth={1.9} />
                Add to Datebook
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
