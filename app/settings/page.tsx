"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import { useDatebookStore } from "@/lib/store";
import { presetMeta, presetOrder } from "@/lib/theme-presets";
import {
  buildCustomThemeVars,
  customThemeColorScheme,
  CUSTOM_THEME_VAR_NAMES,
  DEFAULT_CUSTOM_THEME,
  type CustomThemeColors,
} from "@/lib/custom-theme";
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
import type { AppearancePreset, Density, LandingView, MobileDayDetails, ReminderPreset } from "@/lib/types";

export default function SettingsPage() {
  const settings = useDatebookStore((s) => s.settings);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const categories = useDatebookStore((s) => s.categories);
  const addCategory = useDatebookStore((s) => s.addCategory);
  const updateCategory = useDatebookStore((s) => s.updateCategory);
  const deleteCategory = useDatebookStore((s) => s.deleteCategory);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const addReminderPreset = useDatebookStore((s) => s.addReminderPreset);
  const updateReminderPreset = useDatebookStore((s) => s.updateReminderPreset);
  const deleteReminderPreset = useDatebookStore((s) => s.deleteReminderPreset);
  const replaceFromBackup = useDatebookStore((s) => s.replaceFromBackup);
  const resetAllData = useDatebookStore((s) => s.resetAllData);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#007AFF");
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [newReminderMinutes, setNewReminderMinutes] = useState("30");

  const applyPreset = (preset: AppearancePreset) => {
    const root = document.documentElement;
    root.setAttribute("data-preset", preset);
    // Applied synchronously (ahead of the store update reaching ThemeProvider's
    // effect) for the same zero-flicker swap a built-in preset gets from its
    // static `:root[data-preset]` CSS — a custom theme has no such rule, so it
    // has to get its variables written by hand here too.
    if (preset === "custom") {
      const colors = settings.customTheme ?? DEFAULT_CUSTOM_THEME;
      for (const [name, value] of Object.entries(buildCustomThemeVars(colors))) {
        root.style.setProperty(name, value);
      }
      root.style.setProperty("color-scheme", customThemeColorScheme(colors));
    } else {
      for (const name of CUSTOM_THEME_VAR_NAMES) root.style.removeProperty(name);
      root.style.removeProperty("color-scheme");
    }
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
            Applied when quick-add doesn&apos;t pick up a reminder from what you typed. Tap a reminder to use
            it by default, or swipe it — left to delete, right to rename.
          </p>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {reminderPresets.map((rp) =>
            editingReminderId === rp.id ? (
              <EditReminderRow
                key={rp.id}
                preset={rp}
                onSave={(patch) => {
                  updateReminderPreset(rp.id, patch);
                  setEditingReminderId(null);
                }}
                onCancel={() => setEditingReminderId(null)}
              />
            ) : (
              <ReminderPresetRow
                key={rp.id}
                preset={rp}
                active={settings.defaultReminderPresetIds.includes(rp.id)}
                onToggle={() => {
                  const active = settings.defaultReminderPresetIds.includes(rp.id);
                  haptic("light");
                  updateSettings({
                    defaultReminderPresetIds: active
                      ? settings.defaultReminderPresetIds.filter((id) => id !== rp.id)
                      : [...settings.defaultReminderPresetIds, rp.id],
                  });
                }}
                onEdit={() => setEditingReminderId(rp.id)}
                onDelete={() => {
                  haptic("light");
                  deleteReminderPreset(rp.id);
                }}
              />
            )
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-2.5">
          <input
            type="number"
            min={1}
            value={newReminderMinutes}
            onChange={(e) => setNewReminderMinutes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const n = parseInt(newReminderMinutes, 10);
              if (!Number.isFinite(n) || n < 1) return;
              addReminderPreset({ label: formatOffsetLabel(n), offsetMinutes: n });
              setNewReminderMinutes("30");
            }}
            className="min-w-0 w-16 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
            aria-label="New reminder, minutes before"
          />
          <span className="flex-1 text-[13px] text-ink-faint">
            min before {"→"} {formatOffsetLabel(parseInt(newReminderMinutes, 10) || 0)}
          </span>
          <button
            disabled={!(parseInt(newReminderMinutes, 10) > 0)}
            onClick={() => {
              const n = parseInt(newReminderMinutes, 10);
              if (!Number.isFinite(n) || n < 1) return;
              haptic("light");
              addReminderPreset({ label: formatOffsetLabel(n), offsetMinutes: n });
              setNewReminderMinutes("30");
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
            aria-label="Add reminder"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
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
          {presetOrder.map((preset) =>
            preset === "custom" ? (
              <CustomPresetCard
                key={preset}
                colors={settings.customTheme ?? DEFAULT_CUSTOM_THEME}
                active={settings.preset === "custom"}
                onSelect={() => applyPreset("custom")}
              />
            ) : (
              <PresetCard
                key={preset}
                preset={preset}
                active={settings.preset === preset}
                onSelect={() => applyPreset(preset)}
              />
            )
          )}
        </div>

        <AnimatePresence initial={false}>
          {settings.preset === "custom" && (
            <motion.div
              key="custom-editor"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                height: motionTokens.springLayout,
                opacity: { duration: motionTokens.micro, ease: motionTokens.easeInOut },
              }}
              className="overflow-hidden"
            >
              <div className="pt-3.5">
                <CustomThemeEditor
                  colors={settings.customTheme ?? DEFAULT_CUSTOM_THEME}
                  onChange={(colors) => updateSettings({ customTheme: colors })}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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

function CustomPresetCard({
  colors,
  active,
  onSelect,
}: {
  colors: CustomThemeColors;
  active: boolean;
  onSelect: () => void;
}) {
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
        active ? "border-accent" : "border-line/80 hover:border-line-strong"
      )}
    >
      <div className="flex overflow-hidden rounded-lg border border-line/60">
        {[colors.background, colors.surface, colors.accent].map((c, i) => (
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
          Custom
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
        <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">Pick your own three colors.</p>
      </div>
    </motion.button>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const [draft, setDraft] = useState(value);

  function commit() {
    const v = draft.trim();
    if (HEX.test(v)) onChange(v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v);
    else setDraft(value);
  }

  return (
    <label className="flex items-center gap-2.5 rounded-xl border border-line/80 bg-surface px-3 py-2.5">
      <input
        type="color"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDraft(e.target.value);
        }}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
        aria-label={`${label} color`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          spellCheck={false}
          aria-label={`${label} hex value`}
          className="block w-full bg-transparent font-mono text-[13px] text-ink focus:outline-none"
        />
      </span>
    </label>
  );
}

function CustomThemeEditor({
  colors,
  onChange,
}: {
  colors: CustomThemeColors;
  onChange: (colors: CustomThemeColors) => void;
}) {
  const vars = useMemo(() => buildCustomThemeVars(colors), [colors]);
  const scheme = useMemo(() => customThemeColorScheme(colors), [colors]);

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-line/80 bg-surface-sunken/30 p-3.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <ColorField
          label="Background"
          value={colors.background}
          onChange={(v) => onChange({ ...colors, background: v })}
        />
        <ColorField label="Surface" value={colors.surface} onChange={(v) => onChange({ ...colors, surface: v })} />
        <ColorField label="Accent" value={colors.accent} onChange={(v) => onChange({ ...colors, accent: v })} />
      </div>

      {/* Live demo — scoped to these exact derived tokens, not just the three
          raw picks, so it shows what the app will actually look like. */}
      <div
        style={{ background: vars["--surface-base"], borderColor: vars["--line"], colorScheme: scheme }}
        className="overflow-hidden rounded-xl border p-3 transition-colors duration-200"
      >
        <div className="flex items-center justify-between">
          <span
            style={{ color: vars["--ink"] }}
            className="text-[11.5px] font-semibold tracking-tight transition-colors duration-200"
          >
            Preview
          </span>
          <span style={{ color: vars["--ink-faint"] }} className="text-[10.5px] transition-colors duration-200">
            Today
          </span>
        </div>

        <div
          style={{ background: vars["--surface"], borderColor: vars["--line"] }}
          className="mt-2.5 rounded-lg border p-2.5 transition-colors duration-200"
        >
          <div className="flex items-center gap-2">
            <motion.span
              layout
              style={{ background: vars["--accent"] }}
              className="h-2 w-2 shrink-0 rounded-full transition-colors duration-200"
            />
            <span
              style={{ color: vars["--ink"] }}
              className="text-[12.5px] font-medium transition-colors duration-200"
            >
              Team sync
            </span>
          </div>
          <p style={{ color: vars["--ink-soft"] }} className="mt-0.5 text-[11px] transition-colors duration-200">
            10:00 AM · Studio
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              style={{ background: vars["--accent"], color: vars["--accent-ink"] }}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-200"
            >
              Accent
            </span>
            <span
              style={{ background: vars["--good-soft"], color: vars["--good"] }}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-200"
            >
              Done
            </span>
            <span
              style={{ background: vars["--warn-soft"], color: vars["--warn"] }}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-200"
            >
              Overdue
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Turns a raw minute offset into the same style of label the built-in
 *  presets use ("2 hours before", "1 day before") instead of leaving new
 *  reminders stuck with a generic "Reminder" name. */
function formatOffsetLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "before";
  const WEEK = 7 * 24 * 60;
  const DAY = 24 * 60;
  if (minutes % WEEK === 0) {
    const n = minutes / WEEK;
    return `${n} week${n === 1 ? "" : "s"} before`;
  }
  if (minutes % DAY === 0) {
    const n = minutes / DAY;
    return `${n} day${n === 1 ? "" : "s"} before`;
  }
  if (minutes % 60 === 0) {
    const n = minutes / 60;
    return `${n} hour${n === 1 ? "" : "s"} before`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
}

const REMINDER_REVEAL = 76;

/**
 * A settings row that both taps (toggle default) and swipes (iOS-style,
 * left reveals delete, right reveals edit) — the two gestures don't fight
 * because toggling rides Framer's `onTap`, which only fires when the pointer
 * never crossed its own drag threshold, rather than a native `onClick` that
 * would also fire after a real drag.
 */
function ReminderPresetRow({
  preset,
  active,
  onToggle,
  onEdit,
  onDelete,
}: {
  preset: ReminderPreset;
  active: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const x = useMotionValue(0);
  const [open, setOpen] = useState<"none" | "edit" | "delete">("none");

  function snapTo(target: number, next: "none" | "edit" | "delete") {
    animate(x, target, { type: "spring", stiffness: 460, damping: 40 });
    setOpen(next);
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-0 flex items-stretch justify-between" aria-hidden={open === "none"}>
        <button
          type="button"
          tabIndex={open === "edit" ? 0 : -1}
          onClick={() => {
            snapTo(0, "none");
            onEdit();
          }}
          className="flex w-[76px] items-center justify-center gap-1 bg-accent text-[12.5px] font-medium text-accent-ink"
          aria-label={`Rename ${preset.label}`}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
        </button>
        <button
          type="button"
          tabIndex={open === "delete" ? 0 : -1}
          onClick={() => {
            setOpen("none");
            onDelete();
          }}
          className="flex w-[76px] items-center justify-center gap-1 bg-warn text-[12.5px] font-medium text-white"
          aria-label={`Delete ${preset.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> Delete
        </button>
      </div>

      <motion.div
        drag="x"
        style={{ x }}
        dragConstraints={{ left: -REMINDER_REVEAL, right: REMINDER_REVEAL }}
        dragElastic={0.04}
        onDragEnd={(_, info) => {
          if (info.offset.x <= -REMINDER_REVEAL / 2) snapTo(-REMINDER_REVEAL, "delete");
          else if (info.offset.x >= REMINDER_REVEAL / 2) snapTo(REMINDER_REVEAL, "edit");
          else snapTo(0, "none");
        }}
        onTap={() => {
          if (open !== "none") {
            snapTo(0, "none");
            return;
          }
          onToggle();
        }}
        className={cn(
          "relative z-[1] flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-3 text-left text-[14px] transition-colors",
          active
            ? "border-accent/40 bg-accent-soft text-ink"
            : "border-line/80 bg-surface text-ink-soft hover:border-line-strong"
        )}
      >
        {preset.label}
        {active && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />}
      </motion.div>
    </div>
  );
}

function EditReminderRow({
  preset,
  onSave,
  onCancel,
}: {
  preset: ReminderPreset;
  onSave: (patch: { label: string; offsetMinutes: number }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(preset.label);
  const [minutes, setMinutes] = useState(String(preset.offsetMinutes));

  function save() {
    const n = parseInt(minutes, 10);
    if (!Number.isFinite(n) || n < 1) return;
    onSave({ label: label.trim() || formatOffsetLabel(n), offsetMinutes: n });
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={motionTokens.springSnappy}
      className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2"
    >
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Label"
        aria-label="Reminder label"
        className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <input
        type="number"
        min={1}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        aria-label="Minutes before"
        className="w-14 shrink-0 bg-transparent text-[14px] text-ink focus:outline-none"
      />
      <span className="shrink-0 text-[11px] text-ink-faint">min</span>
      <button
        type="button"
        onClick={save}
        aria-label="Save reminder"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </motion.div>
  );
}
