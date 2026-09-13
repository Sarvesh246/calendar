"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlignLeft, Bell, CalendarClock, Check, ChevronUp, Copy, ExternalLink, MapPin, Repeat, Shapes, Tag, Timer, Trash2, Type, X } from "lucide-react";
import { motion } from "framer-motion";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import {
  datetimeLocalToIso,
  formatTime,
  isOverdue,
  toDateInputValue,
  toDatetimeLocalValue,
} from "@/lib/date-utils";
import { haptic } from "@/lib/haptic";
import { nanoid } from "@/lib/nanoid";
import { cn } from "@/lib/utils";
import type { Category, Item, ItemStatus, ItemType, Reminder, RepeatFreq } from "@/lib/types";
import { repeatLabel } from "@/lib/repeat";
import { formatOffsetLabel } from "@/lib/reminder-defaults";
import { duplicateItem } from "@/lib/item-actions";
import { formatDuration, plannedMinutes, workSessionsFor } from "@/lib/work-sessions";
import { WeekdayChips } from "@/components/weekday-chips";

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/instructure\.com|canvas/.test(host)) return "Open in Canvas";
    return `Open on ${host}`;
  } catch {
    return "Open link";
  }
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">{label}</p>
        <div className="mt-0.5 text-[12.5px] text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

const FIELD =
  "mt-0.5 w-full min-h-9 rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink " +
  // A focus ring that grows rather than snapping on — `box-shadow` animates
  // where `border-width` does not, so the border colour and the ring move
  // together on one timing. (This used to end on a bare "focus:" — a class name
  // Tailwind can't generate, so the ring it describes was never there.)
  "transition-[border-color,box-shadow,background-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)] " +
  "hover:border-line-strong focus:border-accent focus:bg-surface-elevated focus:outline-none " +
  "focus:shadow-[0_0_0_3px_var(--accent-soft)]";

export function ItemEditor({
  item,
  category,
  clock24h,
  StatusSegmented,
  onCollapse,
  variant = "inline",
}: {
  item: Item;
  category: Category | undefined;
  clock24h: boolean;
  StatusSegmented: (props: {
    value: ItemStatus;
    onChange: (status: ItemStatus) => void;
    layoutScope: string;
  }) => React.ReactNode;
  /** Close the card this editor is expanded inside. */
  onCollapse?: () => void;
  /**
   * `inline` sits inside an expanded card. `inspector` is the shared detail
   * panel: the four things you change most — title, date, class, status — sit
   * at the top, and notes and the rarer options follow below.
   */
  variant?: "inline" | "inspector";
}) {
  const updateItem = useDatebookStore((s) => s.updateItem);
  const setItemStatus = useDatebookStore((s) => s.setItemStatus);
  const setItemRepeat = useDatebookStore((s) => s.setItemRepeat);
  const allCategories = useDatebookStore((s) => s.categories);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const categories = allCategories.filter((c) => !c.archived);
  const [title, setTitle] = useState(item.title);
  const [location, setLocation] = useState(item.location ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [customOffset, setCustomOffset] = useState("30");
  const inspector = variant === "inspector";

  // Re-seed a draft only when its own field changes underneath it (a sync, an
  // undo), so a remote edit to the notes can't wipe a title you're mid-typing.
  const [seen, setSeen] = useState({
    title: item.title,
    location: item.location,
    description: item.description,
  });
  if (
    seen.title !== item.title ||
    seen.location !== item.location ||
    seen.description !== item.description
  ) {
    if (seen.title !== item.title) setTitle(item.title);
    if (seen.location !== item.location) setLocation(item.location ?? "");
    if (seen.description !== item.description) setDescription(item.description ?? "");
    setSeen({ title: item.title, location: item.location, description: item.description });
  }
  const start = new Date(item.at);
  const end = item.endAt ? new Date(item.endAt) : null;
  const isEvent = item.type === "event";
  const timeLabel = item.allDay
    ? "All day"
    : isEvent
      ? `${formatTime(item.at, clock24h)}${end ? ` – ${formatTime(item.endAt!, clock24h)}` : ""}`
      : `Due ${formatTime(item.at, clock24h)}`;

  const patch = (p: Partial<Item>) => updateItem(item.id, p);

  // Moving the start carries the end with it, so a rescheduled event keeps its
  // length instead of ending before it begins.
  const moveStart = (iso: string) => {
    const shift = new Date(iso).getTime() - new Date(item.at).getTime();
    if (!item.endAt || !Number.isFinite(shift)) {
      patch({ at: iso });
      return;
    }
    patch({ at: iso, endAt: new Date(new Date(item.endAt).getTime() + shift).toISOString() });
  };

  const presetOffsets = new Set(reminderPresets.map((p) => p.offsetMinutes));
  // Reminders no preset row stands for (a custom offset, a snooze) still need a
  // row of their own, or they fire with no way to see or remove them.
  const customReminders = (item.reminders ?? []).filter((r) => !presetOffsets.has(r.offsetMinutes));

  const toggleReminder = (preset: { id: string; label: string; offsetMinutes: number }) => {
    const current = item.reminders ?? [];
    const hit = current.find((r) => r.offsetMinutes === preset.offsetMinutes);
    const next: Reminder[] = hit
      ? current.filter((r) => r.id !== hit.id)
      : [
          ...current,
          { id: nanoid(), itemId: item.id, offsetMinutes: preset.offsetMinutes, label: preset.label },
        ];
    patch({ reminders: next.length ? next : undefined });
  };

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== item.title) patch({ title: next });
    else setTitle(item.title);
  };

  const importedNote = item.sourceId && (
    <p className="text-[11.5px] leading-snug text-ink-faint">
      Imported item. Your edits to a field are kept when the feed re-syncs.
    </p>
  );

  const titleBlock = inspector ? (
    <input
      id="inspector-title"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label="Title"
      className="-mx-2 w-[calc(100%+1rem)] rounded-md border border-transparent bg-transparent px-2 py-1 text-[19px] font-semibold leading-snug text-ink transition-[border-color,box-shadow] duration-[var(--motion-standard)] hover:border-line focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]"
    />
  ) : (
    <DetailRow icon={<Type className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Title">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        className={FIELD}
      />
    </DetailRow>
  );

  const classBlock = (
    <DetailRow icon={<Tag className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Class">
      <select
        value={item.categoryId ?? ""}
        onChange={(e) => patch({ categoryId: e.target.value })}
        className={FIELD}
      >
        {/* An item with no class (or one whose class was deleted) must have a
            matching option, or the select silently displays the first class
            while the item is still filed under nothing. */}
        {!category && <option value="">No class</option>}
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        {category && !categories.some((c) => c.id === category.id) && (
          <option value={category.id}>{category.name}</option>
        )}
      </select>
    </DetailRow>
  );

  const whenBlock = (
    <DetailRow icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />} label={isEvent ? "When" : "Due"}>
      <p className="mb-1.5 text-ink-faint">
        {Number.isNaN(start.getTime()) ? "" : start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        <span> · </span>
        {timeLabel}
      </p>
      <AllDayToggle checked={Boolean(item.allDay)} onChange={(v) => patch({ allDay: v })} />
      {item.allDay ? (
        <input
          type="date"
          value={toDateInputValue(item.at)}
          onChange={(e) => {
            if (!e.target.value) return;
            moveStart(new Date(`${e.target.value}T12:00:00`).toISOString());
          }}
          aria-label={isEvent ? "Date" : "Due date"}
          className={FIELD}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            {isEvent && <span className="w-10 shrink-0 text-[11.5px] text-ink-faint">Starts</span>}
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(item.at)}
              onChange={(e) => {
                const iso = datetimeLocalToIso(e.target.value);
                if (iso) moveStart(iso);
              }}
              aria-label={isEvent ? "Starts" : "Due"}
              className={cn(FIELD, "mt-0")}
            />
          </label>
          {isEvent && (
            <label className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11.5px] text-ink-faint">Ends</span>
              <input
                type="datetime-local"
                value={item.endAt ? toDatetimeLocalValue(item.endAt) : ""}
                min={toDatetimeLocalValue(item.at)}
                onChange={(e) => {
                  if (!e.target.value) {
                    patch({ endAt: undefined });
                    return;
                  }
                  const iso = datetimeLocalToIso(e.target.value);
                  // An end before the start isn't a time, it's a typo — keep
                  // the last good value rather than store a negative length.
                  if (iso && new Date(iso) > start) patch({ endAt: iso });
                }}
                aria-label="Ends"
                className={cn(FIELD, "mt-0")}
              />
            </label>
          )}
        </div>
      )}
    </DetailRow>
  );

  const typeBlock = (
    <DetailRow icon={<Shapes className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Type">
      <select
        value={item.type}
        onChange={(e) => {
          const type = e.target.value as ItemType;
          patch(type === "event" ? { type, status: undefined } : { type, status: item.status ?? "todo" });
        }}
        className={FIELD}
      >
        <option value="event">Event</option>
        <option value="assignment">Assignment</option>
        <option value="task">Task</option>
      </select>
    </DetailRow>
  );

  const locationBlock = (
    <DetailRow icon={<MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Location">
      <input
        value={location}
        placeholder="Optional"
        onChange={(e) => setLocation(e.target.value)}
        onBlur={() => {
          const next = location.trim() || undefined;
          if (next !== item.location) patch({ location: next });
        }}
        className={FIELD}
      />
    </DetailRow>
  );

  const statusBlock = !isEvent && (
    <DetailRow icon={<Check className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Status">
      <StatusSegmented
        value={item.status ?? "todo"}
        layoutScope={`${variant}-${item.id}`}
        onChange={(status) => setItemStatus(item.id, status)}
      />
      {isOverdue(item) && item.status !== "done" && <p className="mt-1.5 text-warn">Overdue</p>}
    </DetailRow>
  );

  const remindersBlock = (
    <DetailRow icon={<Bell className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Reminders">
      <div className="flex flex-col gap-1">
        {reminderPresets.map((rp) => {
          const active = (item.reminders ?? []).some((r) => r.offsetMinutes === rp.offsetMinutes);
          return (
            <button
              key={rp.id}
              type="button"
              onClick={() => {
                haptic("light");
                toggleReminder(rp);
              }}
              aria-pressed={active}
              className={cn(
                "flex min-h-9 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12.5px]",
                "transition-[background-color,border-color,color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
                active
                  ? "border-accent/40 bg-accent-soft text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink"
              )}
            >
              {rp.label}
              <motion.span
                aria-hidden
                initial={false}
                animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
                transition={motionTokens.springSnappy}
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
              >
                <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />
              </motion.span>
            </button>
          );
        })}
        {customReminders.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              haptic("light");
              const next = (item.reminders ?? []).filter((x) => x.id !== r.id);
              patch({ reminders: next.length ? next : undefined });
            }}
            aria-label={`Remove ${r.label}`}
            className="flex min-h-9 items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-left text-[12.5px] text-ink transition-[border-color] duration-[var(--motion-standard)] hover:border-accent"
          >
            {r.label}
            <X className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.25} />
          </button>
        ))}
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={customOffset}
            onChange={(e) => setCustomOffset(e.target.value)}
            className={cn(FIELD, "mt-0 w-20")}
            aria-label="Custom reminder minutes"
          />
          <span className="text-[12px] text-ink-faint">min before</span>
          <button
            type="button"
            onClick={() => {
              const n = parseInt(customOffset, 10);
              if (!Number.isFinite(n) || n < 1) return;
              const current = item.reminders ?? [];
              if (current.some((r) => r.offsetMinutes === n)) return;
              patch({
                reminders: [
                  ...current,
                  { id: nanoid(), itemId: item.id, offsetMinutes: n, label: formatOffsetLabel(n) },
                ],
              });
              haptic("light");
            }}
            className="rounded-md border border-line px-2 py-1.5 text-[12px] font-medium text-ink-soft hover:text-ink"
          >
            Add
          </button>
        </div>
      </div>
    </DetailRow>
  );

  const repeatBlock = !item.sourceId && (
    <DetailRow icon={<Repeat className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Repeat">
      <select
        value={item.repeat?.freq ?? ""}
        onChange={(e) => {
          const v = e.target.value as RepeatFreq | "";
          if (!v) setItemRepeat(item.id, undefined);
          else {
            setItemRepeat(item.id, {
              freq: v,
              ...(v === "weekly" ? { byDay: [new Date(item.at).getDay()] } : {}),
            });
          }
        }}
        className={FIELD}
      >
        <option value="">Does not repeat</option>
        <option value="daily">Every day</option>
        <option value="weekly">Every week</option>
        <option value="monthly">Every month</option>
      </select>
      {item.repeat?.freq === "weekly" && (
        <div className="mt-2">
          <WeekdayChips
            value={
              item.repeat.byDay?.length
                ? item.repeat.byDay
                : [new Date(item.at).getDay()]
            }
            onChange={(days) => {
              if (days.length === 0) return;
              setItemRepeat(item.id, { ...item.repeat!, freq: "weekly", byDay: days });
            }}
          />
        </div>
      )}
      {item.repeat && (
        <p className="mt-1 text-[11.5px] text-ink-faint">{repeatLabel(item.repeat)}</p>
      )}
    </DetailRow>
  );

  const detailsBlock = (
    <DetailRow icon={<AlignLeft className="h-3.5 w-3.5" strokeWidth={1.75} />} label={inspector ? "Notes" : "Details"}>
      <textarea
        value={description}
        rows={inspector ? 4 : 3}
        placeholder="Notes"
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          const next = description.trim() || undefined;
          if (next !== item.description) patch({ description: next });
        }}
        className={cn(FIELD, "resize-y")}
      />
    </DetailRow>
  );

  const linkBlock = item.url && (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] font-medium text-accent transition-colors hover:border-accent"
    >
      <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
      {linkLabel(item.url)}
    </a>
  );

  const workBlock = <WorkLinks item={item} clock24h={clock24h} />;

  return (
    <div
      className={cn("flex flex-col gap-3", !inspector && "mt-3 border-t border-line pt-3")}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {inspector ? (
        <>
          {titleBlock}
          {importedNote}
          {whenBlock}
          {classBlock}
          {statusBlock}
          {workBlock}
          <p className="mt-2 border-t border-line pt-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            More
          </p>
          {detailsBlock}
          {locationBlock}
          {typeBlock}
          {remindersBlock}
          {repeatBlock}
          {linkBlock}
        </>
      ) : (
        <>
          {importedNote}
          {titleBlock}
          {classBlock}
          {whenBlock}
          {typeBlock}
          {locationBlock}
          {statusBlock}
          {workBlock}
          {remindersBlock}
          {repeatBlock}
          {detailsBlock}
          {linkBlock}
        </>
      )}

      <ItemActions item={item} onCollapse={onCollapse} />
    </div>
  );
}

/**
 * The thread between a deadline and the time set aside for it: a session
 * links back to its assignment, an assignment lists its sessions.
 */
function WorkLinks({ item, clock24h }: { item: Item; clock24h: boolean }) {
  const items = useDatebookStore((s) => s.items);
  const openInspector = useUIStore((s) => s.openInspector);
  const target = item.workFor ? items.find((i) => i.id === item.workFor) : undefined;
  const sessions = useMemo(
    () => (item.type !== "event" ? workSessionsFor(items, item.id) : []),
    [items, item.id, item.type]
  );
  const linkClass =
    "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken/60";

  if (item.workFor) {
    return (
      <DetailRow icon={<Timer className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Planned work for">
        {target ? (
          <button type="button" className={linkClass} onClick={() => openInspector(target.id)}>
            <span className="min-w-0 truncate font-medium">{target.title}</span>
            <span className="shrink-0 text-ink-faint">
              Due {format(new Date(target.at), "EEE, MMM d")}
            </span>
          </button>
        ) : (
          <p className="text-ink-faint">The item this time was set aside for is no longer on your calendar.</p>
        )}
      </DetailRow>
    );
  }
  if (!sessions.length) return null;
  return (
    <DetailRow
      icon={<Timer className="h-3.5 w-3.5" strokeWidth={1.75} />}
      label={`Planned time · ${formatDuration(plannedMinutes(sessions))}`}
    >
      <div className="flex flex-col gap-1">
        {sessions.slice(0, 4).map((s) => (
          <button key={s.id} type="button" className={linkClass} onClick={() => openInspector(s.id)}>
            <span>{format(new Date(s.at), "EEE, MMM d")}</span>
            <span className="shrink-0 tabular-nums text-ink-faint">
              {formatTime(s.at, clock24h)}
              {s.endAt ? ` – ${formatTime(s.endAt, clock24h)}` : ""}
            </span>
          </button>
        ))}
        {sessions.length > 4 && <p className="text-[11.5px] text-ink-faint">and {sessions.length - 4} more</p>}
      </div>
    </DetailRow>
  );
}

/**
 * A real switch for "All day". The raw `<input type="checkbox">` here was the
 * only unstyled control in the app and gave a ~13px target on touch.
 */
function AllDayToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      className="press-none mb-1.5 flex min-h-9 items-center gap-2 text-[12.5px] text-ink"
    >
      <span
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border",
          "transition-[background-color,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
          checked ? "border-accent bg-accent" : "border-line-strong bg-surface"
        )}
      >
        <motion.span
          initial={false}
          animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={motionTokens.springSnappy}
        >
          <Check className="h-3 w-3 text-accent-ink" strokeWidth={3} />
        </motion.span>
      </span>
      All day
    </button>
  );
}

function ItemActions({ item, onCollapse }: { item: Item; onCollapse?: () => void }) {
  const deleteItem = useDatebookStore((s) => s.deleteItem);
  const deleteSeries = useDatebookStore((s) => s.deleteSeries);
  // Every delete lands in the undo toast, so a single item goes in one tap. A
  // repeating one asks which — that's a real choice, not a confirmation.
  const [choosing, setChoosing] = useState(false);

  // Leaving the choice armed after the editor closes means the next open starts
  // on it, one stray tap from wiping the series.
  useEffect(() => {
    if (!choosing) return;
    const t = window.setTimeout(() => setChoosing(false), 6000);
    return () => window.clearTimeout(t);
  }, [choosing]);

  return (
    <motion.div layout="position" transition={motionTokens.springLayout} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {choosing && item.repeatId ? (
        <>
          <span className="text-[12.5px] font-medium text-warn">Delete…</span>
          <button
            type="button"
            onClick={() => {
              haptic("warn");
              deleteItem(item.id);
            }}
            className="min-h-11 rounded-lg bg-warn px-3 text-[12.5px] font-medium text-white"
          >
            This one
          </button>
          <button
            type="button"
            onClick={() => {
              haptic("warn");
              deleteSeries(item.repeatId!);
            }}
            className="min-h-11 rounded-lg border border-warn px-3 text-[12.5px] font-medium text-warn"
          >
            Whole series
          </button>
          <button
            type="button"
            onClick={() => setChoosing(false)}
            className="min-h-11 rounded-lg px-3 text-[12.5px] font-medium text-ink-soft"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              if (item.repeatId) {
                setChoosing(true);
                return;
              }
              haptic("warn");
              deleteItem(item.id);
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-warn transition-colors hover:bg-warn/10"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              haptic("light");
              duplicateItem(item);
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />
            Duplicate
          </button>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
              Close
            </button>
          )}
        </>
      )}
    </motion.div>
  );
}
