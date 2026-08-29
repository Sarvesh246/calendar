"use client";

import { useEffect, useState } from "react";
import { AlignLeft, Bell, CalendarClock, Check, ExternalLink, MapPin, Repeat, Tag, Trash2 } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
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
  "mt-0.5 w-full min-h-9 rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink focus:border-accent focus:outline-none";

export function ItemEditor({
  item,
  category,
  clock24h,
  StatusSegmented,
}: {
  item: Item;
  category: Category | undefined;
  clock24h: boolean;
  StatusSegmented: (props: {
    value: ItemStatus;
    onChange: (status: ItemStatus) => void;
    layoutScope: string;
  }) => React.ReactNode;
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

  useEffect(() => {
    setTitle(item.title);
    setLocation(item.location ?? "");
    setDescription(item.description ?? "");
  }, [item.id, item.title, item.location, item.description]);
  const start = new Date(item.at);
  const end = item.endAt ? new Date(item.endAt) : null;
  const isEvent = item.type === "event";
  const timeLabel = item.allDay
    ? "All day"
    : isEvent
      ? `${formatTime(item.at, clock24h)}${end ? ` – ${formatTime(item.endAt!, clock24h)}` : ""}`
      : `Due ${formatTime(item.at, clock24h)}`;

  const patch = (p: Partial<Item>) => updateItem(item.id, p);

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

  return (
    <div
      className="mt-3 flex flex-col gap-3 border-t border-line pt-3"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {item.sourceId && (
        <p className="text-[11.5px] leading-snug text-ink-faint">
          Imported item — your edits to a field are kept when the feed re-syncs.
        </p>
      )}

      <DetailRow icon={<Tag className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== item.title) patch({ title: next });
            else setTitle(item.title);
          }}
          className={FIELD}
        />
      </DetailRow>

      <DetailRow icon={<Tag className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Class">
        <select
          value={item.categoryId}
          onChange={(e) => patch({ categoryId: e.target.value })}
          className={FIELD}
        >
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

      <DetailRow icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />} label={isEvent ? "When" : "Due"}>
        <p className="mb-1.5 text-ink-faint">
          {Number.isNaN(start.getTime()) ? "" : start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          <span> · </span>
          {timeLabel}
        </p>
        <label className="mb-1.5 flex items-center gap-2 text-[12.5px] text-ink">
          <input
            type="checkbox"
            checked={Boolean(item.allDay)}
            onChange={(e) => patch({ allDay: e.target.checked })}
          />
          All day
        </label>
        {item.allDay ? (
          <input
            type="date"
            value={toDateInputValue(item.at)}
            onChange={(e) => {
              if (!e.target.value) return;
              patch({ at: new Date(`${e.target.value}T12:00:00`).toISOString() });
            }}
            className={FIELD}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(item.at)}
              onChange={(e) => {
                const iso = datetimeLocalToIso(e.target.value);
                if (iso) patch({ at: iso });
              }}
              className={FIELD}
            />
            {isEvent && (
              <input
                type="datetime-local"
                value={item.endAt ? toDatetimeLocalValue(item.endAt) : ""}
                onChange={(e) => {
                  if (!e.target.value) {
                    patch({ endAt: undefined });
                    return;
                  }
                  const iso = datetimeLocalToIso(e.target.value);
                  if (iso) patch({ endAt: iso });
                }}
                className={FIELD}
              />
            )}
          </div>
        )}
      </DetailRow>

      <DetailRow icon={<Tag className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Type">
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

      {!isEvent && (
        <DetailRow icon={<Check className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Status">
          <StatusSegmented
            value={item.status ?? "todo"}
            layoutScope={item.id}
            onChange={(status) => setItemStatus(item.id, status)}
          />
          {isOverdue(item) && item.status !== "done" && <p className="mt-1.5 text-warn">Overdue</p>}
        </DetailRow>
      )}

      <DetailRow icon={<Bell className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Reminders">
        <div className="flex flex-col gap-1">
          {reminderPresets.map((rp) => {
            const active = (item.reminders ?? []).some((r) => r.offsetMinutes === rp.offsetMinutes);
            return (
              <button
                key={rp.id}
                type="button"
                onClick={() => toggleReminder(rp)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-left text-[12.5px]",
                  active ? "border-accent/40 bg-accent-soft text-ink" : "border-line text-ink-soft"
                )}
              >
                {rp.label}
              </button>
            );
          })}
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
                    { id: nanoid(), itemId: item.id, offsetMinutes: n, label: `${n} min before` },
                  ],
                });
              }}
              className="rounded-md border border-line px-2 py-1.5 text-[12px] font-medium text-ink-soft hover:text-ink"
            >
              Add
            </button>
          </div>
        </div>
      </DetailRow>

      {!item.sourceId && (
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
          {item.repeat && (
            <p className="mt-1 text-[11.5px] text-ink-faint">{repeatLabel(item.repeat)}</p>
          )}
        </DetailRow>
      )}

      <DetailRow icon={<AlignLeft className="h-3.5 w-3.5" strokeWidth={1.75} />} label="Details">
        <textarea
          value={description}
          rows={3}
          placeholder="Notes"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const next = description.trim() || undefined;
            if (next !== item.description) patch({ description: next });
          }}
          className={cn(FIELD, "resize-y")}
        />
      </DetailRow>

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] font-medium text-accent transition-colors hover:border-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          {linkLabel(item.url)}
        </a>
      )}

      <ItemActions item={item} />
    </div>
  );
}

function ItemActions({ item }: { item: Item }) {
  const deleteItem = useDatebookStore((s) => s.deleteItem);
  const deleteSeries = useDatebookStore((s) => s.deleteSeries);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirm ? (
        <>
          <span className="text-[12.5px] text-warn">Delete this?</span>
          <button
            type="button"
            onClick={() => {
              haptic("warn");
              deleteItem(item.id);
            }}
            className="min-h-11 rounded-lg bg-warn px-3 text-[12.5px] font-medium text-white"
          >
            Delete
          </button>
          {item.repeatId && (
            <button
              type="button"
              onClick={() => {
                haptic("warn");
                deleteSeries(item.repeatId!);
              }}
              className="min-h-11 rounded-lg border border-warn px-3 text-[12.5px] font-medium text-warn"
            >
              Delete series
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="min-h-11 rounded-lg px-3 text-[12.5px] font-medium text-ink-soft"
          >
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-warn"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          Delete
        </button>
      )}
    </div>
  );
}
