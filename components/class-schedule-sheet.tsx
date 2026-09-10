"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Plus, X } from "lucide-react";
import { setHours, setMinutes } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { thisOrNextWeekday } from "@/lib/date-utils";
import {
  clockInput,
  firstSharedDay,
  parseClassSchedule,
  scheduleRepeat,
  weekdayLong,
  type ClassMeeting,
} from "@/lib/class-schedule";
import { defaultUntilIso } from "@/lib/repeat";
import { nanoid } from "@/lib/nanoid";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WeekdayChips } from "@/components/weekday-chips";
import type { Day } from "date-fns";

export { WeekdayChips };

const FIELD =
  "w-full min-w-0 rounded-lg border border-line bg-surface-sunken/50 px-3 py-2.5 text-[16px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none md:text-[14px]";

type MeetingDraft = {
  key: string;
  days: number[];
  start: string;
  end: string;
};

function draftMeeting(days: number[], start = "10:00", end = "10:50"): MeetingDraft {
  return { key: nanoid(), days, start, end };
}

function fromParsed(meeting: ClassMeeting): MeetingDraft {
  return draftMeeting(
    meeting.days,
    clockInput(meeting.hour, meeting.minute),
    clockInput(meeting.endHour, meeting.endMinute)
  );
}

function leftoverDays(meetings: MeetingDraft[]): number[] {
  const used = new Set(meetings.flatMap((m) => m.days));
  const tth = [2, 4].filter((d) => !used.has(d));
  if (tth.length === 2) return tth;
  const mw = [1, 3].filter((d) => !used.has(d));
  if (mw.length === 2) return mw;
  return [1, 2, 3, 4, 5].filter((d) => !used.has(d));
}

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
  const [meetings, setMeetings] = useState<MeetingDraft[]>(() => [draftMeeting([1, 3, 5])]);
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
    const name = categories.find((c) => c.id === first)?.name ?? "";
    const untilDay = defaultUntilIso().slice(0, 10);
    queueMicrotask(() => {
      setCategoryId(first);
      setTitle(name);
      setMeetings([draftMeeting([1, 3, 5])]);
      setLocation("");
      setUntil(untilDay);
      setPaste("");
      setError(null);
    });
  }, [open, presetCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  function patchMeeting(key: string, patch: Partial<MeetingDraft>) {
    setMeetings((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  function applyPaste() {
    const parsed = parseClassSchedule(paste, categories);
    if (!parsed) {
      setError("Couldn't read days and a time range from that.");
      return;
    }
    setError(null);
    setTitle(parsed.title);
    if (parsed.categoryId) setCategoryId(parsed.categoryId);
    setMeetings(parsed.meetings.map(fromParsed));
    if (parsed.location) setLocation(parsed.location);
    if (parsed.until) setUntil(parsed.until.slice(0, 10));
    haptic("success");
  }

  function submit() {
    if (meetings.some((m) => m.days.length === 0)) {
      setError("Pick at least one day for each time.");
      return;
    }
    const parsedTimes: { days: number[]; sh: number; sm: number; eh: number; em: number }[] = [];
    for (const meeting of meetings) {
      const [sh, sm] = meeting.start.split(":").map(Number);
      const [eh, em] = meeting.end.split(":").map(Number);
      if (!Number.isFinite(sh) || !Number.isFinite(eh) || eh * 60 + em <= sh * 60 + sm) {
        setError("End time needs to be after the start.");
        return;
      }
      parsedTimes.push({ days: meeting.days, sh, sm, eh, em });
    }
    const shared = firstSharedDay(meetings);
    if (shared !== null) {
      setError(`${weekdayLong(shared)} is on two times. Give that day one time.`);
      return;
    }
    const cat = categoryId || categories[0]?.id;
    if (!cat) {
      setError("Add a class first.");
      return;
    }
    const untilIso = until ? new Date(`${until}T23:59:59`).toISOString() : defaultUntilIso();
    const name = title.trim() || categories.find((c) => c.id === cat)?.name || "Class";
    for (const meeting of parsedTimes) {
      const day = meeting.days[0] as Day;
      const first = thisOrNextWeekday(day);
      const at = setMinutes(setHours(first, meeting.sh), meeting.sm);
      const endAt = setMinutes(setHours(first, meeting.eh), meeting.em);
      addItem({
        title: name,
        type: "event",
        categoryId: cat,
        at: at.toISOString(),
        endAt: endAt.toISOString(),
        ...(location.trim() ? { location: location.trim() } : {}),
        repeat: scheduleRepeat(meeting.days, untilIso),
      });
    }
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
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={motionTokens.springGentle}
            className={cn(
              "absolute flex w-full max-w-full flex-col overflow-hidden border border-line bg-surface",
              "inset-x-0 bottom-0 max-h-[min(92dvh,760px)] rounded-t-2xl",
              "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[12vh] md:max-h-[min(80dvh,640px)] md:w-[calc(100%-2rem)] md:max-w-[400px] md:-translate-x-1/2 md:rounded-2xl"
            )}
          >
            <span
              aria-hidden
              className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-line-strong opacity-75 md:hidden"
            />
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
              <div className="min-w-0">
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
              <label className="block text-[12px] font-medium text-ink-faint">Paste or type</label>
              <div className="mt-1.5 flex min-w-0 gap-2">
                <input
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyPaste()}
                  placeholder="MATH MW 4:15–5:00 TTh 5:30–6:45"
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

              <p className="mt-4 text-[12px] font-medium text-ink-faint">Weekly times</p>
              <div className="mt-1.5 flex flex-col gap-2">
                {meetings.map((meeting, index) => (
                  <div
                    key={meeting.key}
                    className={cn(
                      "min-w-0",
                      meetings.length > 1 && "rounded-xl border border-line px-3 py-3"
                    )}
                  >
                    {meetings.length > 1 && (
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[12.5px] font-medium text-ink">Time {index + 1}</p>
                        <button
                          type="button"
                          onClick={() => setMeetings((prev) => prev.filter((m) => m.key !== meeting.key))}
                          className="text-[12.5px] font-medium text-ink-faint hover:text-ink"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    <WeekdayChips
                      value={meeting.days}
                      onChange={(days) => patchMeeting(meeting.key, { days })}
                    />
                    <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
                      <label className="block min-w-0">
                        <span className="text-[12px] font-medium text-ink-faint">Starts</span>
                        <input
                          type="time"
                          value={meeting.start}
                          onChange={(e) => patchMeeting(meeting.key, { start: e.target.value })}
                          className={cn(FIELD, "mt-1.5")}
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="text-[12px] font-medium text-ink-faint">Ends</span>
                        <input
                          type="time"
                          value={meeting.end}
                          onChange={(e) => patchMeeting(meeting.key, { end: e.target.value })}
                          className={cn(FIELD, "mt-1.5")}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const last = meetings[meetings.length - 1];
                  const days = leftoverDays(meetings);
                  setMeetings((prev) => [
                    ...prev,
                    draftMeeting(days.length ? days : [], last?.start ?? "16:15", last?.end ?? "17:00"),
                  ]);
                  haptic("light");
                }}
                className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[13px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                Add a different time
              </button>

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

            <div className="flex shrink-0 gap-2 border-t border-line/70 px-4 pt-3 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.5rem))]">
              <button
                type="button"
                onClick={close}
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-line text-[13.5px] font-medium text-ink-soft hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                className="flex min-h-11 min-w-0 flex-[1.35] items-center justify-center gap-1.5 rounded-xl bg-accent px-2 text-[13.5px] font-medium text-accent-ink"
              >
                <CalendarClock className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span className="truncate">Add to Datebook</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
