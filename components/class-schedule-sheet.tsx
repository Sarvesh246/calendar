"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Plus, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  clockInput,
  firstOverlappingDay,
  meetingDateTimes,
  parseClassSchedule,
  parseClockInput,
  scheduleRepeat,
  untilDayToIso,
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

export { WeekdayChips };

const FIELD =
  "w-full min-w-0 max-w-full rounded-lg border border-line bg-surface-sunken/50 px-3 py-2.5 text-[16px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none md:text-[14px]";

const SELECT =
  "min-h-11 min-w-0 w-full rounded-lg border border-line bg-surface-sunken/50 px-1 text-center text-[16px] text-ink focus:border-line-strong focus:outline-none";

const DATE_FIELD = cn(
  FIELD,
  "[appearance:none] [-webkit-appearance:none]",
  "[&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left",
  "[&::-webkit-datetime-edit]:min-w-0 [&::-webkit-datetime-edit]:p-0"
);

const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = parseClockInput(value) ?? { hour: 10, minute: 0 };
  const hour12 = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  const pm = parsed.hour >= 12;
  const minuteOpts = MINUTES.includes(parsed.minute)
    ? MINUTES
    : [...MINUTES, parsed.minute].sort((a, b) => a - b);

  function emit(nextHour12: number, nextMinute: number, nextPm: boolean) {
    const hour = (nextHour12 % 12) + (nextPm ? 12 : 0);
    onChange(clockInput(hour, nextMinute));
  }

  return (
    <div className="min-w-0">
      <span className="text-[12px] font-medium text-ink-faint">{label}</span>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1.05fr)] items-center gap-1">
        <select
          aria-label={`${label} hour`}
          value={hour12}
          onChange={(e) => emit(Number(e.target.value), parsed.minute, pm)}
          className={SELECT}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-[13px] font-medium text-ink-faint">:</span>
        <select
          aria-label={`${label} minute`}
          value={parsed.minute}
          onChange={(e) => emit(hour12, Number(e.target.value), pm)}
          className={SELECT}
        >
          {minuteOpts.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} AM or PM`}
          value={pm ? "pm" : "am"}
          onChange={(e) => emit(hour12, parsed.minute, e.target.value === "pm")}
          className={SELECT}
        >
          <option value="am">AM</option>
          <option value="pm">PM</option>
        </select>
      </div>
    </div>
  );
}

export function ClassScheduleSheet() {
  const open = useUIStore((s) => s.classScheduleOpen);
  return (
    <AnimatePresence>
      {open && <ClassScheduleSheetBody />}
    </AnimatePresence>
  );
}

function ClassScheduleSheetBody() {
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

  useLockBodyScroll(true);

  useEffect(() => {
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
  }, [presetCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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
    const parsedMeetings: ClassMeeting[] = [];
    for (const meeting of meetings) {
      const start = parseClockInput(meeting.start);
      const end = parseClockInput(meeting.end);
      if (!start || !end) {
        setError("Pick a start and end time.");
        return;
      }
      const next: ClassMeeting = {
        days: meeting.days,
        hour: start.hour,
        minute: start.minute,
        endHour: end.hour,
        endMinute: end.minute,
      };
      if (!meetingDateTimes(next)) {
        setError("End time needs to be after the start.");
        return;
      }
      parsedMeetings.push(next);
    }
    // A lecture and a lab on the same day are two times, not a conflict; only
    // times that actually overlap are.
    const clash = firstOverlappingDay(parsedMeetings);
    if (clash !== null) {
      setError(`Two of these times overlap on ${weekdayLong(clash)}.`);
      return;
    }
    const cat = categoryId || categories[0]?.id;
    if (!cat) {
      setError("Add a class first.");
      return;
    }
    const untilIso = untilDayToIso(until);
    const name = title.trim() || categories.find((c) => c.id === cat)?.name || "Class";
    const before = useDatebookStore.getState().items.length;
    try {
      for (const meeting of parsedMeetings) {
        const range = meetingDateTimes(meeting);
        if (!range) continue;
        addItem({
          title: name,
          type: "event",
          categoryId: cat,
          at: range.at.toISOString(),
          endAt: range.endAt.toISOString(),
          ...(location.trim() ? { location: location.trim() } : {}),
          repeat: scheduleRepeat(meeting.days, untilIso),
        });
      }
    } catch (err) {
      console.warn("[datebook] couldn't add class times", err);
      setError("Couldn't add those times. Try again.");
      return;
    }
    if (useDatebookStore.getState().items.length <= before) {
      setError("Couldn't add those times. Try again.");
      return;
    }
    haptic("success");
    close();
  }

  return (
        <div className="viewport-pinned-overlay fixed inset-0 z-[60] overflow-x-hidden">
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
            style={{
              maxHeight:
                "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.25rem)",
            }}
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-4 right-4 mx-auto flex min-h-0 min-w-0 max-w-[380px] flex-col overflow-hidden rounded-2xl border border-line bg-surface"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line/70 px-3 py-3">
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

            <div
              className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3"
              style={{
                maxHeight:
                  "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 11.5rem)",
              }}
            >
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
                    <div className="mt-3 flex min-w-0 flex-col gap-2">
                      <TimeField
                        label="Starts"
                        value={meeting.start}
                        onChange={(start) => patchMeeting(meeting.key, { start })}
                      />
                      <TimeField
                        label="Ends"
                        value={meeting.end}
                        onChange={(end) => patchMeeting(meeting.key, { end })}
                      />
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

              <label className="mt-4 block min-w-0 text-[12px] font-medium text-ink-faint">Until</label>
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className={cn(DATE_FIELD, "mt-1.5")}
              />
            </div>

            <div className="shrink-0 border-t border-line/70 px-3 pt-3 pb-3">
              {error && <p className="mb-2 text-[12.5px] text-warn">{error}</p>}
              <div className="flex min-w-0 gap-2">
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
            </div>
          </motion.div>
        </div>
  );
}
