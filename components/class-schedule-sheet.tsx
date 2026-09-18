"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { CalendarClock, Plus, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  clockInput,
  firstOverlappingDay,
  meetingDateTimes,
  parseClassSchedule,
  parseClockInput,
  savedClassMeetings,
  savedMeetingSlotEqual,
  scheduleRepeat,
  untilDayToIso,
  weekdayLong,
  type ClassMeeting,
  type SavedClassMeeting,
} from "@/lib/class-schedule";
import { defaultUntilIso } from "@/lib/repeat";
import { nanoid } from "@/lib/nanoid";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { haptic } from "@/lib/haptic";
import { SHEET_DRAG, shouldDismissSheet, startSheetDrag, useSheetOverscroll } from "@/lib/sheet-gesture";
import { Scrim } from "@/components/ui/scrim";
import { SheetHandle } from "@/components/sheet-handle";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WeekdayChips } from "@/components/weekday-chips";
import type { Item } from "@/lib/types";

export { WeekdayChips };

const FIELD =
  "w-full min-w-0 max-w-full rounded-lg border border-line bg-surface-sunken/50 px-3 py-2.5 text-[16px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none md:text-[14px]";

const DATE_FIELD = cn(
  FIELD,
  "[appearance:none] [-webkit-appearance:none]",
  "[&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left",
  "[&::-webkit-datetime-edit]:min-w-0 [&::-webkit-datetime-edit]:p-0"
);

type MeetingDraft = {
  key: string;
  repeatId?: string;
  days: number[];
  start: string;
  end: string;
};

function draftMeeting(
  days: number[],
  start = "10:00",
  end = "10:50",
  repeatId?: string
): MeetingDraft {
  return { key: repeatId ?? nanoid(), repeatId, days, start, end };
}

function fromParsed(meeting: ClassMeeting): MeetingDraft {
  return draftMeeting(
    meeting.days,
    clockInput(meeting.hour, meeting.minute),
    clockInput(meeting.endHour, meeting.endMinute)
  );
}

function fromSaved(meeting: SavedClassMeeting): MeetingDraft {
  const endHour = meeting.endHour ?? meeting.hour;
  const endMinute =
    meeting.endMinute ??
    (meeting.endHour == null ? Math.min(meeting.minute + 50, 59) : meeting.minute);
  return draftMeeting(
    meeting.days,
    clockInput(meeting.hour, meeting.minute),
    clockInput(endHour, endMinute),
    meeting.repeatId
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
  return (
    <label className="min-w-0">
      <span className="text-[12px] font-medium text-ink-faint">{label}</span>
      <input
        type="time"
        step={60}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(DATE_FIELD, "mt-1.5")}
      />
    </label>
  );
}

function snapshotOf(state: {
  title: string;
  categoryId: string;
  meetings: MeetingDraft[];
  location: string;
  until: string;
}) {
  return JSON.stringify({
    title: state.title,
    categoryId: state.categoryId,
    location: state.location,
    until: state.until,
    meetings: state.meetings.map((m) => ({
      repeatId: m.repeatId ?? "",
      days: m.days,
      start: m.start,
      end: m.end,
    })),
  });
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
  const items = useDatebookStore((s) => s.items);
  const categories = allCategories.filter((c) => !c.archived);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  useSheetOverscroll(scrollRef, dragControls);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [meetings, setMeetings] = useState<MeetingDraft[]>(() => [draftMeeting([1, 3, 5])]);
  const [location, setLocation] = useState("");
  const [until, setUntil] = useState("");
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef("");

  useLockBodyScroll(true);

  function loadCategory(id: string) {
    const cat = categories.find((c) => c.id === id);
    const saved = savedClassMeetings(items, id);
    const first = saved[0];
    const occ = first ? items.find((item) => item.id === first.ids[0]) : undefined;
    const nextTitle = cat?.classTitle?.trim() || first?.title || cat?.name || "";
    const nextLocation = first?.location ?? occ?.location ?? "";
    const nextUntil = (first?.until ?? defaultUntilIso()).slice(0, 10);
    const nextMeetings = saved.length ? saved.map(fromSaved) : [draftMeeting([1, 3, 5])];
    setCategoryId(id);
    setTitle(nextTitle);
    setMeetings(nextMeetings);
    setLocation(nextLocation);
    setUntil(nextUntil);
    setPaste("");
    setError(null);
    baseline.current = snapshotOf({
      title: nextTitle,
      categoryId: id,
      meetings: nextMeetings,
      location: nextLocation,
      until: nextUntil,
    });
  }

  useEffect(() => {
    const first =
      presetCategoryId && categories.some((c) => c.id === presetCategoryId)
        ? presetCategoryId
        : categories.find((c) => savedClassMeetings(items, c.id).length > 0)?.id ??
          categories[0]?.id ??
          "";
    queueMicrotask(() => loadCategory(first));
    // Load once when the sheet opens; category changes go through the select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetCategoryId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function parseDrafts(): ClassMeeting[] | null {
    if (meetings.some((m) => m.days.length === 0)) {
      setError("Pick at least one day for each time.");
      return null;
    }
    const parsedMeetings: ClassMeeting[] = [];
    for (const meeting of meetings) {
      const start = parseClockInput(meeting.start);
      const end = parseClockInput(meeting.end);
      if (!start || !end) {
        setError("Pick a start and end time.");
        return null;
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
        return null;
      }
      parsedMeetings.push(next);
    }
    const clash = firstOverlappingDay(parsedMeetings);
    if (clash !== null) {
      setError(`Two of these times overlap on ${weekdayLong(clash)}.`);
      return null;
    }
    return parsedMeetings;
  }

  function persist(): boolean {
    const parsedMeetings = parseDrafts();
    if (!parsedMeetings) return false;
    const cat = categoryId || categories[0]?.id;
    if (!cat) {
      setError("Add a class first.");
      return false;
    }
    const untilIso = untilDayToIso(until);
    const name = title.trim() || categories.find((c) => c.id === cat)?.name || "Class";
    const loc = location.trim();
    const store = useDatebookStore.getState();
    const existing = savedClassMeetings(store.items, cat);
    const drafts = meetings.map((draft, i) => ({ draft, parsed: parsedMeetings[i] }));

    try {
      for (const saved of existing) {
        if (!drafts.some(({ draft }) => draft.repeatId === saved.repeatId)) {
          store.deleteSeries(saved.repeatId);
        }
      }

      for (const { draft, parsed } of drafts) {
        const prev = draft.repeatId
          ? existing.find((m) => m.repeatId === draft.repeatId)
          : undefined;
        if (prev && savedMeetingSlotEqual(prev, parsed)) {
          patchSeriesMeta(store, prev, name, loc, untilIso);
          continue;
        }
        if (prev) store.deleteSeries(prev.repeatId);
        const range = meetingDateTimes(parsed);
        if (!range) continue;
        store.addItem({
          title: name,
          type: "event",
          categoryId: cat,
          at: range.at.toISOString(),
          endAt: range.endAt.toISOString(),
          ...(loc ? { location: loc } : {}),
          repeat: scheduleRepeat(parsed.days, untilIso),
        });
      }

      const catObj = store.categories.find((c) => c.id === cat);
      if (catObj) {
        const nick = title.trim() && title.trim() !== catObj.name ? title.trim() : undefined;
        if ((catObj.classTitle ?? "") !== (nick ?? "")) {
          store.updateCategory(cat, { classTitle: nick });
        }
      }
    } catch (err) {
      console.warn("[datebook] couldn't save class times", err);
      setError("Couldn't save those times. Try again.");
      return false;
    }

    setError(null);
    baseline.current = snapshotOf({ title, categoryId: cat, meetings, location, until });
    return true;
  }

  function dirty() {
    return (
      snapshotOf({ title, categoryId, meetings, location, until }) !== baseline.current
    );
  }

  function dismiss() {
    if (dirty() && !persist()) return;
    close();
  }

  const editing =
    Boolean(categoryId) && savedClassMeetings(items, categoryId).length > 0;

  return (
        <div className="viewport-pinned-overlay fixed inset-0 z-[60] overflow-x-hidden">
          <Scrim label="Dismiss" onClick={dismiss} />
          <motion.div
            role="dialog"
            ref={panelRef}
            aria-modal="true"
            aria-labelledby={headingId}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={motionTokens.springGentle}
            style={{
              willChange: "transform",
              maxHeight:
                "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.25rem)",
            }}
            {...SHEET_DRAG}
            dragControls={dragControls}
            onDragStart={() => setDragging(true)}
            onDragEnd={(_, info) => {
              setDragging(false);
              if (shouldDismissSheet(info)) {
                haptic("light");
                dismiss();
              }
            }}
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-4 right-4 mx-auto flex min-h-0 min-w-0 max-w-[380px] flex-col overflow-hidden rounded-2xl border border-line bg-surface pt-0.5"
          >
            <SheetHandle dragControls={dragControls} dragging={dragging} />
            <div
              className="flex shrink-0 cursor-grab items-start justify-between gap-3 border-b border-line/70 px-3 pb-3 active:cursor-grabbing"
              onPointerDown={(e) => startSheetDrag(dragControls, e)}
            >
              <div className="min-w-0">
                <p id={headingId} className="text-[16px] font-semibold text-ink">
                  Class times
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-soft">
                  {editing
                    ? "Edit this class’s weekly meetings."
                    : "Add weekly meetings for this class."}
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <div
              ref={scrollRef}
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
                  const next = e.target.value;
                  if (dirty() && !persist()) return;
                  loadCategory(next);
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

              <p className="mt-4 text-[12px] font-medium text-ink-faint">
                {editing ? "Current weekly times" : "Weekly times"}
              </p>
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
                  onClick={dismiss}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-line text-[13.5px] font-medium text-ink-soft hover:text-ink"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!persist()) return;
                    haptic("success");
                    close();
                  }}
                  className="flex min-h-11 min-w-0 flex-[1.35] items-center justify-center gap-1.5 rounded-xl bg-accent px-2 text-[13.5px] font-medium text-accent-ink"
                >
                  <CalendarClock className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span className="truncate">Save</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
  );
}

function patchSeriesMeta(
  store: {
    items: Item[];
    updateItem: (id: string, patch: Partial<Item>) => void;
  },
  saved: SavedClassMeeting,
  title: string,
  location: string,
  untilIso: string
) {
  for (const id of saved.ids) {
    const item = store.items.find((row) => row.id === id);
    if (!item) continue;
    const patch: Partial<Item> = {};
    if (item.title !== title) patch.title = title;
    if ((item.location ?? "") !== location) {
      patch.location = location || undefined;
    }
    if (item.repeat && (item.repeat.until ?? "") !== untilIso) {
      patch.repeat = { ...item.repeat, until: untilIso };
    }
    if (Object.keys(patch).length) store.updateItem(id, patch);
  }
}
