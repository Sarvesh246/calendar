"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useDatebookStore } from "@/lib/store";
import { presetMeta, presetOrder } from "@/lib/theme-presets";
import { ToggleSwitch } from "@/components/toggle-switch";
import { ImportCalendar } from "@/components/import-calendar";
import { AccountSection } from "@/components/account-section";
import { NotificationToggle } from "@/components/notification-toggle";
import { serializeIcs } from "@/lib/ics";
import { parseBackup, serializeBackup } from "@/lib/backup";
import { PwaInstallButton } from "@/components/pwa-install";
import { cn } from "@/lib/utils";
import { motion as motionTokens } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import type { AppearancePreset, Density, LandingView, MobileDayDetails } from "@/lib/types";

export default function SettingsPage() {
  const settings = useDatebookStore((s) => s.settings);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const categories = useDatebookStore((s) => s.categories);
  const addCategory = useDatebookStore((s) => s.addCategory);
  const updateCategory = useDatebookStore((s) => s.updateCategory);
  const deleteCategory = useDatebookStore((s) => s.deleteCategory);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const replaceFromBackup = useDatebookStore((s) => s.replaceFromBackup);
  const resetAllData = useDatebookStore((s) => s.resetAllData);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#007AFF");

  const applyPreset = (preset: AppearancePreset) => {
    document.documentElement.setAttribute("data-preset", preset);
    updateSettings({ preset });
  };

  return (
    // Every other page runs the full width of the pane; settings used to stop at
    // a phone-shaped column and leave two thirds of a desktop window empty. It
    // now spreads into two tracks once there's room, with the heading and the
    // most-used card spanning both so the page still starts where you expect.
    <div className="mx-auto w-full max-w-[1120px] pb-4">
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-5">
      <header className="pt-1 xl:col-span-2">
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
          Tune how Datebook opens, looks, and keeps your calendar in sync.
        </p>
      </header>

      {/* Most-changed preferences — always visible */}
      <SettingsCard className="xl:col-span-2">
        <CardHeading title="Everyday preferences" sub="What you see first and how the calendar feels day to day." />
        <div className="mt-4 flex flex-col gap-5">
          <SettingBlock label="Open Datebook to" hint="The first screen when you launch the app.">
            <Segmented
              segmentId="landing-view"
              value={settings.landingView}
              options={[
                { value: "today", label: "Today" },
                { value: "calendar", label: "Calendar" },
                { value: "agenda", label: "Agenda" },
              ]}
              onChange={(v) => updateSettings({ landingView: v as LandingView })}
            />
          </SettingBlock>

          <SettingBlock
            label="When you tap a day on mobile"
            hint="Choose how the day's schedule appears on your phone."
          >
            <Segmented
              segmentId="mobile-day-details"
              value={settings.mobileDayDetails}
              options={[
                { value: "sheet", label: "Slide-up panel" },
                { value: "inline", label: "List below calendar" },
              ]}
              onChange={(v) => updateSettings({ mobileDayDetails: v as MobileDayDetails })}
            />
          </SettingBlock>

          <SettingBlock label="Calendar density" hint="How much fits on screen at once.">
            <Segmented
              segmentId="density"
              value={settings.density}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
                { value: "spacious", label: "Spacious" },
              ]}
              onChange={(v) => {
                document.documentElement.setAttribute("data-density", v);
                updateSettings({ density: v as Density });
              }}
            />
          </SettingBlock>
        </div>
      </SettingsCard>

      <CollapsibleCard title="Account & sync" sub="Sign in to back up and sync across devices." storageKey="account">
        <AccountSection />
      </CollapsibleCard>

      <CollapsibleCard
        title="Calendar & categories"
        sub="Organize items by color and pull in events from other calendars."
        storageKey="calendar"
      >
        <div className="flex flex-col gap-2">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-3 rounded-xl border border-line/80 bg-surface-sunken/40 px-3 py-2.5"
            >
              <input
                type="color"
                value={cat.color}
                onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
                className="h-7 w-7 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
                aria-label={`${cat.name} color`}
              />
              <input
                value={cat.name}
                onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
                // A category with no name is a blank row here, a blank chip on
                // every card, and a NOT NULL column in the cloud. The field
                // stays clearable while you retype it; leaving it empty is what
                // gets repaired.
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name !== cat.name) updateCategory(cat.id, { name: name || "Uncategorized" });
                }}
                aria-label={`${cat.name} name`}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink focus:outline-none"
              />
              {cat.archived && <span className="text-[11px] text-ink-faint">Archived</span>}
              <button
                type="button"
                onClick={() => updateCategory(cat.id, { archived: !cat.archived })}
                className="text-[12px] font-medium text-ink-faint hover:text-ink"
              >
                {cat.archived ? "Restore" : "Archive"}
              </button>
              {categories.length > 1 && (
                <button
                  type="button"
                  onClick={() => deleteCategory(cat.id)}
                  className="text-[12px] font-medium text-warn"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5">
          <input
            type="color"
            value={newCategoryColor}
            onChange={(e) => setNewCategoryColor(e.target.value)}
            className="h-7 w-7 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
            aria-label="New category color"
          />
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !newCategoryName.trim()) return;
              e.preventDefault();
              addCategory({ name: newCategoryName.trim(), color: newCategoryColor });
              setNewCategoryName("");
            }}
            placeholder="New category"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            disabled={!newCategoryName.trim()}
            onClick={() => {
              addCategory({ name: newCategoryName.trim(), color: newCategoryColor });
              setNewCategoryName("");
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
            aria-label="Add category"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <Divider />

        <Subheading title="Import a calendar link" />
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Paste a feed URL from Canvas, Google Calendar, or Outlook. Datebook pulls titles, due dates, and descriptions. Re-sync any time for updates.
        </p>
        <ImportCalendar />

        <Divider />

        <Subheading title="Export" />
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Download an .ics file for Google Calendar, Outlook, or Apple Calendar.
        </p>
        <button
          type="button"
          onClick={() => {
            const items = useDatebookStore.getState().items;
            const blob = new Blob([serializeIcs(items)], { type: "text/calendar;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "datebook.ics";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="self-start rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          Download .ics
        </button>
      </CollapsibleCard>

      <CollapsibleCard title="Reminders" sub="In-app alerts and default reminder timing." storageKey="reminders">
        <NotificationToggle />
        <div className="mt-2">
          <Subheading title="Default reminders" />
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
            Applied when quick-add doesn&apos;t pick up a reminder from what you typed.
          </p>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {reminderPresets.map((rp) => {
            const active = settings.defaultReminderPresetIds.includes(rp.id);
            return (
              <button
                key={rp.id}
                onClick={() =>
                  updateSettings({
                    defaultReminderPresetIds: active
                      ? settings.defaultReminderPresetIds.filter((id) => id !== rp.id)
                      : [...settings.defaultReminderPresetIds, rp.id],
                  })
                }
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-[14px] transition-colors",
                  active
                    ? "border-accent/40 bg-accent-soft text-ink"
                    : "border-line/80 bg-surface-sunken/30 text-ink-soft hover:border-line-strong"
                )}
              >
                {rp.label}
                {active && <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Display options" sub="Clock, week layout, and what shows on cards." storageKey="display">
        <div className="flex flex-col gap-4">
          <SettingBlock label="Week starts on">
            <Segmented
              segmentId="week-starts"
              value={String(settings.weekStartsOn)}
              options={[
                { value: "0", label: "Sunday" },
                { value: "1", label: "Monday" },
              ]}
              onChange={(v) => updateSettings({ weekStartsOn: Number(v) as 0 | 1 })}
            />
          </SettingBlock>

          <ToggleRow
            label="24-hour clock"
            checked={settings.clock24h}
            onChange={(v) => updateSettings({ clock24h: v })}
          />
          <ToggleRow
            label="Show location on events"
            checked={settings.showLocation}
            onChange={(v) => updateSettings({ showLocation: v })}
          />
          <ToggleRow
            label="Category color dots"
            checked={settings.showCategoryDot}
            onChange={(v) => updateSettings({ showCategoryDot: v })}
          />
          <ToggleRow
            label="Hide completed items"
            checked={settings.hideCompleted}
            onChange={(v) => updateSettings({ hideCompleted: v })}
          />
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="Appearance"
        sub="Optional color themes. Minimal is the default look."
        storageKey="appearance"
        defaultOpen={false}
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {presetOrder.map((preset) => (
            <PresetCard
              key={preset}
              preset={preset}
              active={settings.preset === preset}
              onSelect={() => applyPreset(preset)}
            />
          ))}
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Install app" sub="Add Datebook to your home screen for offline use." storageKey="install">
        <PwaInstallButton />
      </CollapsibleCard>

      {/* Backup & reset — always expanded, pinned to bottom */}
      <SettingsCard variant="danger" className="xl:col-span-2">
        <CardHeading
          title="Backup & reset"
          sub="Download a full copy of your data, restore from a file, or wipe this device clean."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const s = useDatebookStore.getState();
              const blob = new Blob(
                [
                  serializeBackup({
                    categories: s.categories,
                    items: s.items,
                    reminderPresets: s.reminderPresets,
                    settings: s.settings,
                    importSources: s.importSources,
                  }),
                ],
                { type: "application/json" }
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "datebook-backup.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Download backup
          </button>
          <label className="cursor-pointer rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink">
            Restore backup
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const backup = parseBackup(await file.text());
                  if (!confirm("Replace everything on this device with this backup?")) return;
                  replaceFromBackup(backup);
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Couldn't read that file.");
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!confirm("Delete all items and imported feeds on this device? This cannot be undone.")) return;
              resetAllData();
            }}
            className="rounded-xl border border-warn/40 px-4 py-2.5 text-[13px] font-medium text-warn"
          >
            Reset calendar data
          </button>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          <a href="/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-ink-soft">
            Privacy policy
          </a>
          {" · "}
          <a href="/terms" className="underline decoration-line-strong underline-offset-2 hover:text-ink-soft">
            Terms of use
          </a>
        </p>
      </SettingsCard>
      </div>
    </div>
  );
}

function SettingsCard({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "danger";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border p-4 sm:p-5",
        variant === "danger"
          ? "border-warn/25 bg-surface"
          : "border-line/80 bg-surface",
        className
      )}
    >
      {children}
    </section>
  );
}

function CollapsibleCard({
  title,
  sub,
  children,
  storageKey,
  defaultOpen = false,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
}) {
  const [open, toggle] = useSectionOpen(storageKey, defaultOpen);

  return (
    <section className="overflow-hidden rounded-lg border border-line/80 bg-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group flex w-full items-start justify-between gap-3 p-4 text-left sm:p-5"
      >
        <CardHeading title={title} sub={sub} />
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 0 : -90 }}
          transition={motionTokens.spring}
          className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors group-hover:bg-surface-sunken group-hover:text-ink"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: motionTokens.springLayout,
              opacity: { duration: motionTokens.micro, ease: motionTokens.easeInOut },
            }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-4 border-t border-line/60 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * Remembered open/closed state for a settings section.
 *
 * Reading localStorage in `useState`'s initialiser looked harmless but ran on
 * the client only — the prerendered HTML had the section in its default state,
 * so any card the user had left open hydrated with mismatched markup and React
 * threw the whole subtree away and re-rendered it. `useSyncExternalStore` gives
 * the server render the default and the client its stored value, which is
 * exactly the case it exists for.
 */
const sectionOpen = new Map<string, boolean>();
const sectionListeners = new Set<() => void>();

function sectionKey(storageKey: string) {
  return `datebook-section:${storageKey}`;
}

function subscribeSections(onChange: () => void) {
  sectionListeners.add(onChange);
  return () => sectionListeners.delete(onChange);
}

function useSectionOpen(storageKey: string, defaultOpen: boolean): [boolean, () => void] {
  const key = sectionKey(storageKey);
  const open = useSyncExternalStore(
    subscribeSections,
    () => {
      const cached = sectionOpen.get(key);
      if (cached !== undefined) return cached;
      let value = defaultOpen;
      try {
        const stored = localStorage.getItem(key);
        if (stored !== null) value = stored === "1";
      } catch {
        /* storage disabled */
      }
      sectionOpen.set(key, value);
      return value;
    },
    () => defaultOpen
  );

  const toggle = () => {
    const next = !(sectionOpen.get(key) ?? defaultOpen);
    sectionOpen.set(key, next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* storage disabled */
    }
    for (const listener of sectionListeners) listener();
  };

  return [open, toggle];
}

function CardHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
      {sub && <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{sub}</p>}
    </div>
  );
}

function Subheading({ title }: { title: string }) {
  return <p className="text-[13px] font-medium text-ink">{title}</p>;
}

function Divider() {
  return <div className="my-1 h-px bg-line/60" role="separator" />;
}

function SettingBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-[14px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-sunken/30 px-3 py-2.5">
      <span className="text-[14px] text-ink">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Segmented({
  segmentId,
  value,
  options,
  onChange,
}: {
  segmentId: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-line/80 bg-surface-sunken/40 p-1 sm:w-auto">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "press-none relative min-h-10 flex-1 rounded-lg px-3 text-[13px] font-medium transition-colors sm:flex-none sm:px-4",
              active ? "text-accent-ink" : "text-ink-soft hover:text-ink"
            )}
            aria-pressed={active}
          >
            {active && (
              <motion.span
                layoutId={`settings-segment-${segmentId}`}
                className="absolute inset-0 rounded-lg bg-accent"
                transition={motionTokens.spring}
              />
            )}
            <span className="relative z-[1] whitespace-nowrap">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PresetCard({
  preset,
  active,
  onSelect,
}: {
  preset: AppearancePreset;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = presetMeta[preset];
  return (
    <motion.button
      type="button"
      onClick={() => {
        haptic("light");
        onSelect();
      }}
      aria-pressed={active}
      whileTap={{ scale: 0.975 }}
      transition={motionTokens.springSnappy}
      className={cn(
        "press-none group relative flex flex-col gap-2 rounded-xl border p-3 text-left",
        "transition-[border-color,box-shadow] duration-[var(--motion-standard)]",
        active
          ? "border-accent"
          : "border-line/80 hover:border-line-strong"
      )}
    >
      <div className="flex overflow-hidden rounded-lg border border-line/60">
        {meta.swatch.map((c, i) => (
          <motion.span
            key={i}
            initial={false}
            animate={{ flexGrow: active && i === 2 ? 1.6 : 1 }}
            transition={motionTokens.spring}
            className="h-7 flex-1"
            style={{ background: c }}
          />
        ))}
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          {meta.label}
          <motion.span
            aria-hidden
            initial={false}
            animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
            transition={motionTokens.springSnappy}
            className="flex h-3.5 w-3.5 items-center justify-center"
          >
            <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />
          </motion.span>
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">{meta.description}</p>
      </div>
    </motion.button>
  );
}
