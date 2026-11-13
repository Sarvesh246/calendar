"use client";

import { useAuth } from "@/components/auth-provider";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarClock, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAnimatedCollapse } from "@/lib/use-animated-collapse";
import Link from "next/link";
import { useDatebookStore } from "@/lib/store";
import { presetOrder } from "@/lib/theme-presets";
import { paintAppearance } from "@/components/theme-provider";
import { writeAppearanceSnapshot } from "@/lib/appearance-storage";
import { DEFAULT_CUSTOM_THEME, type CustomThemeColors } from "@/lib/custom-theme";
import { ImportCalendar } from "@/components/import-calendar";
import { ImportSyllabus, SyllabusImportProvider } from "@/components/import-syllabus";
import { AccountSection } from "@/components/account-section";
import { DiagnosticsSettings } from "@/components/diagnostics-settings";
import { AppLockSection } from "@/components/app-lock-section";
import { NativeIosSection } from "@/components/native-ios-section";
import { NotificationToggle } from "@/components/notification-toggle";
import { serializeIcs } from "@/lib/ics";
import { parseBackup, serializeBackup } from "@/lib/backup";
import { PwaInstallButton } from "@/components/pwa-install";
import { MobileRoomHeader } from "@/components/mobile-room-header";
import { cn } from "@/lib/utils";
import { useSlidingPill } from "@/lib/sliding-pill";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import {
  CLASS_REMINDER_OPTIONS,
  classReminderLabel,
  classReminderOptionLabel,
} from "@/lib/class-reminder";
import { formatOffsetLabel } from "@/lib/reminder-defaults";
import type { AppearancePreset, Density, LandingView, MobileDayDetails } from "@/lib/types";

import {
  CardHeading,
  Divider,
  Segmented,
  SettingBlock,
  Subheading,
  ToggleRow,
} from "@/components/settings/primitives";
import { lazyComponent } from "@/lib/lazy-component";
import type { ComponentProps } from "react";
import type { CategoryEditor as CategoryEditorImpl } from "@/components/settings/category-editor";
import type {
  CustomPresetCard as CustomPresetCardImpl,
  CustomThemeEditor as CustomThemeEditorImpl,
  PresetCard as PresetCardImpl,
} from "@/components/settings/look-cards";
import type {
  EditReminderRow as EditReminderRowImpl,
  ReminderPresetRow as ReminderPresetRowImpl,
} from "@/components/settings/reminder-rows";

// Closed-by-default cards keep their heavy editors in separate chunks. A
// card only mounts these once opened (see `lazy` on CollapsibleCard), so the
// Settings route no longer ships every editor up front.
const CategoryEditor = lazyComponent<ComponentProps<typeof CategoryEditorImpl>>(() =>
  import("@/components/settings/category-editor").then((m) => m.CategoryEditor),
);
const PresetCard = lazyComponent<ComponentProps<typeof PresetCardImpl>>(() =>
  import("@/components/settings/look-cards").then((m) => m.PresetCard),
);
const CustomPresetCard = lazyComponent<ComponentProps<typeof CustomPresetCardImpl>>(() =>
  import("@/components/settings/look-cards").then((m) => m.CustomPresetCard),
);
const CustomThemeEditor = lazyComponent<ComponentProps<typeof CustomThemeEditorImpl>>(() =>
  import("@/components/settings/look-cards").then((m) => m.CustomThemeEditor),
);
const ReminderPresetRow = lazyComponent<ComponentProps<typeof ReminderPresetRowImpl>>(() =>
  import("@/components/settings/reminder-rows").then((m) => m.ReminderPresetRow),
);
const CalendarFeedSection = lazyComponent<object>(() =>
  import("@/components/settings/calendar-feed").then((m) => m.CalendarFeedSection),
);
const EditReminderRow = lazyComponent<ComponentProps<typeof EditReminderRowImpl>>(() =>
  import("@/components/settings/reminder-rows").then((m) => m.EditReminderRow),
);

/** `/settings#…` targets: which collapsible section to open, and what to scroll to. */
const DEEP_LINKS: Record<string, { section: string; anchor: string }> = {
  import: { section: "import", anchor: "import" },
  reminders: { section: "reminders", anchor: "reminders" },
};

const ANCHOR_OFFSET = "scroll-mt-[calc(var(--mobile-header-height)+1rem)] md:scroll-mt-6";

function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking in the same tick can cancel the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsPage() {
  const reducedMotion = prefersReducedMotion();
  const { user: accountUser, configured: cloudConfigured } = useAuth();
  const syncStatus = useDatebookStore((s) => s.syncStatus);
  const settings = useDatebookStore((s) => s.settings);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const categories = useDatebookStore((s) => s.categories);
  const addCategory = useDatebookStore((s) => s.addCategory);
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const colorPersist = useRef(0);
  const pendingColors = useRef<CustomThemeColors | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(colorPersist.current);
      if (pendingColors.current) {
        useDatebookStore.getState().updateSettings({ customTheme: pendingColors.current });
        pendingColors.current = null;
      }
    },
    [],
  );

  // Deep links from onboarding and the palette open the section they point into
  // and bring it on screen, instead of dropping you at the top of a long page.
  useEffect(() => {
    function reveal() {
      const target = DEEP_LINKS[window.location.hash.slice(1)];
      if (!target) return;
      const wasOpen = openSection(target.section);
      window.setTimeout(
        () =>
          document
            .getElementById(target.anchor)
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        wasOpen ? 0 : 360,
      );
    }
    // A tick late: the router commits the URL (and its hash) after this mounts.
    const t = window.setTimeout(reveal, 0);
    window.addEventListener("hashchange", reveal);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", reveal);
    };
  }, []);

  const applyPreset = (preset: AppearancePreset) => {
    window.clearTimeout(colorPersist.current);
    const pending = pendingColors.current;
    pendingColors.current = null;
    // Same-frame paint (ahead of ThemeProvider's layout effect) so a click
    // feels like the built-in `:root[data-preset]` swap. Selecting Custom also
    // seeds `customTheme` so a reload has something to restore.
    if (preset === "custom") {
      const colors = pending ?? settings.customTheme ?? DEFAULT_CUSTOM_THEME;
      paintAppearance("custom", colors);
      updateSettings({ preset: "custom", customTheme: colors });
    } else {
      paintAppearance(preset);
      updateSettings({ preset, ...(pending ? { customTheme: pending } : {}) });
    }
  };

  const applyCustomColors = (colors: CustomThemeColors) => {
    paintAppearance("custom", colors);
    writeAppearanceSnapshot({
      preset: "custom",
      density: settings.density,
      customTheme: colors,
    });
    window.clearTimeout(colorPersist.current);
    pendingColors.current = colors;
    colorPersist.current = window.setTimeout(() => {
      pendingColors.current = null;
      updateSettings({ preset: "custom", customTheme: colors });
    }, 140);
  };

  return (
    // Full-width intro, then a two-column grid on desktop so collapsed
    // section tiles share a row baseline instead of drifting out of line.
    <div className="mx-auto h-auto min-h-0 w-full max-w-[1120px] pb-2">
      <div className="flex flex-col gap-5">
        <MobileRoomHeader title="Settings" />
        <header className="hidden pt-1 md:block">
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
            Tune how Datebook opens, looks, and keeps your calendar in sync.
          </p>
        </header>

        <CollapsibleCard
          title="Everyday preferences"
          sub="What you see first and how the calendar feels day to day."
          storageKey="everyday"
          defaultOpen
        >
          <div className="flex flex-col gap-5">
            <SettingBlock label="Open Datebook to">
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

            <SettingBlock label="Calendar density">
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

            <div className="md:hidden">
              <SettingBlock label="When you tap a day on mobile">
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
            </div>
          </div>
        </CollapsibleCard>

        {/* Phone stack: Account → Classes → Import → Meetings → Reminders → Look.
          Desktop grid keeps columns independent. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
          <div className="order-1 min-w-0">
            <CollapsibleCard
              title="Account & sync"
              // Says where things stand, not what to do — "Sign in to back up" read
              // as a nag to someone already signed in and synced.
              sub={
                accountUser
                  ? syncStatus === "error"
                    ? "Signed in — your latest changes haven't synced yet."
                    : "Backed up to your account and syncing across devices."
                  : cloudConfigured
                    ? "Sign in to back up and sync across devices."
                    : "Everything is saved on this device."
              }
              storageKey="account"
              defaultOpen
            >
              <AccountSection />
              <AppLockSection />
              <NativeIosSection />
              <Divider />
              <DiagnosticsSettings />
              <Divider />
              <Subheading title="Install app" />
              <p className="mb-2 text-[13px] text-ink-soft">
                Home screen shortcut for quicker access.
              </p>
              <PwaInstallButton />
            </CollapsibleCard>
          </div>
          <div className="order-2 min-w-0">
            <CollapsibleCard
              title="Classes"
              sub="Name, color, meeting name, and optional syllabus per class."
              storageKey="classes"
              defaultOpen={false}
              lazy
            >
              <SyllabusImportProvider>
                <div className="flex flex-col gap-2">
                  {categories.map((cat) => (
                    <CategoryEditor
                      key={cat.id}
                      category={cat}
                      categories={categories}
                      confirmDeleteId={confirmDeleteId}
                      onConfirmDeleteId={setConfirmDeleteId}
                    />
                  ))}
                </div>
                <div className="field-shell mt-2 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5">
                  <input
                    type="color"
                    value={newCategoryColor}
                    onChange={(e) => setNewCategoryColor(e.target.value)}
                    className="h-7 w-7 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
                    aria-label="New class color"
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
                    placeholder="New class"
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
                  />
                  <button
                    disabled={!newCategoryName.trim()}
                    onClick={() => {
                      addCategory({ name: newCategoryName.trim(), color: newCategoryColor });
                      setNewCategoryName("");
                    }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
                    aria-label="Add class"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              </SyllabusImportProvider>
            </CollapsibleCard>
          </div>
          <div className="order-3 min-w-0">
            <CollapsibleCard
              id="import"
              title="Import"
              sub="Pull due dates from a calendar feed or a syllabus PDF."
              storageKey="import"
              defaultOpen={false}
            >
              <SyllabusImportProvider>
                <Subheading title="Calendar link" />
                <ImportCalendar />

                <Divider />

                <Subheading title="Syllabus PDF" />
                <ImportSyllabus />
                <p className="mt-2 text-[12.5px] text-ink-faint">
                  To attach a syllabus to a specific class, open that class under Classes.
                </p>
              </SyllabusImportProvider>
            </CollapsibleCard>
          </div>
          <div className="order-4 min-w-0">
            <CollapsibleCard
              title="Weekly meetings"
              sub="Lectures and labs — open a class to edit the times already on it."
              storageKey="meetings"
              defaultOpen={false}
            >
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Weekly meetings are edited per class. Open a class above, or edit them on Schedule.
              </p>
              <Link
                href="/schedule"
                className="mt-3 flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-line px-3.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
              >
                <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
                Edit on Schedule
              </Link>
            </CollapsibleCard>
          </div>
          <div className="order-5 min-w-0">
            <CollapsibleCard
              id="reminders"
              title="Reminders"
              sub="Alerts on this device, class heads-up, and default timing."
              storageKey="reminders"
              defaultOpen={false}
              lazy
            >
              <NotificationToggle />
              <div className="mt-3">
                <Subheading title="Class heads-up" />
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
                  {classReminderLabel(settings.classReminderMinutes)} — also sets when Today starts
                  the countdown.
                </p>
              </div>
              <ClassReminderPicker
                minutes={settings.classReminderMinutes}
                onChange={(minutes) => {
                  haptic("light");
                  updateSettings({ classReminderMinutes: minutes });
                }}
              />
              <Divider />
              <div className="mt-2">
                <Subheading title="Defaults for new items" />
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
                  Applied when quick-add doesn&apos;t pick up a reminder from what you typed. Tap to
                  use by default.
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
                      active={(settings.defaultReminderPresetIds ?? []).includes(rp.id)}
                      onToggle={() => {
                        const selected = settings.defaultReminderPresetIds ?? [];
                        const active = selected.includes(rp.id);
                        haptic("light");
                        updateSettings({
                          defaultReminderPresetIds: active
                            ? selected.filter((id) => id !== rp.id)
                            : [...selected, rp.id],
                        });
                      }}
                      onEdit={() => setEditingReminderId(rp.id)}
                      onDelete={() => {
                        haptic("light");
                        deleteReminderPreset(rp.id);
                      }}
                    />
                  ),
                )}
              </div>

              <div className="field-shell mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-2.5">
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
          </div>
          <div className="order-6 min-w-0">
            <CollapsibleCard
              title="Look"
              sub="Themes and what shows on cards."
              storageKey="look"
              defaultOpen={false}
              lazy
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
                  ),
                )}
              </div>

              <AnimatePresence initial={false}>
                {settings.preset === "custom" && (
                  <motion.div
                    key="custom-editor"
                    initial={reducedMotion ? false : { height: 0 }}
                    animate={{ height: "auto" }}
                    exit={
                      reducedMotion ? { height: 0, transition: { duration: 0 } } : { height: 0 }
                    }
                    transition={reducedMotion ? { duration: 0 } : motionTokens.springLayout}
                    className="overflow-hidden"
                  >
                    <div className="pt-3.5">
                      <CustomThemeEditor
                        colors={settings.customTheme ?? DEFAULT_CUSTOM_THEME}
                        onChange={applyCustomColors}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Divider />
              <div className="flex flex-col gap-4">
                <ToggleRow
                  label="Show location on events"
                  checked={settings.showLocation}
                  onChange={(v) => updateSettings({ showLocation: v })}
                />
                <ToggleRow
                  label="Class color dots"
                  checked={settings.showCategoryDot}
                  onChange={(v) => updateSettings({ showCategoryDot: v })}
                />
              </div>
            </CollapsibleCard>
          </div>
        </div>

        <CollapsibleCard
          title="Backup & export"
          sub="Download a copy, restore from a file, or subscribe from another calendar."
          storageKey="backup"
          defaultOpen={false}
          lazy
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const s = useDatebookStore.getState();
                downloadFile(
                  "datebook-backup.json",
                  new Blob(
                    [
                      serializeBackup({
                        categories: s.categories,
                        items: s.items,
                        reminderPresets: s.reminderPresets,
                        settings: s.settings,
                        importSources: s.importSources,
                      }),
                    ],
                    { type: "application/json" },
                  ),
                );
              }}
              className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
            >
              Download backup
            </button>
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  "datebook.ics",
                  new Blob([serializeIcs(useDatebookStore.getState().items)], {
                    type: "text/calendar;charset=utf-8",
                  }),
                )
              }
              title="For Google Calendar, Outlook, or Apple Calendar"
              className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
            >
              Export .ics
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
          </div>
          <CalendarFeedSection />
          <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
            <a
              href="/privacy"
              className="underline decoration-line-strong underline-offset-2 hover:text-ink-soft"
            >
              Privacy policy
            </a>
            {" · "}
            <a
              href="/terms"
              className="underline decoration-line-strong underline-offset-2 hover:text-ink-soft"
            >
              Terms of use
            </a>
          </p>
        </CollapsibleCard>

        <SettingsCard variant="danger">
          <CardHeading
            title="Reset calendar data"
            sub="Delete all items and imported feeds on this device. This cannot be undone."
          />
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                if (
                  !confirm(
                    "Delete all items and imported feeds on this device? This cannot be undone.",
                  )
                )
                  return;
                resetAllData();
              }}
              className="rounded-xl border border-warn/40 px-4 py-2.5 text-[13px] font-medium text-warn"
            >
              Reset calendar data
            </button>
          </div>
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
        variant === "danger" ? "border-warn/25 bg-surface" : "border-line/80 bg-surface",
        className,
      )}
    >
      {children}
    </section>
  );
}

function CollapsibleCard({
  id,
  title,
  sub,
  children,
  storageKey,
  defaultOpen = false,
  lazy = false,
}: {
  id?: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  /** Don't mount the body until the card has been opened once. */
  lazy?: boolean;
}) {
  const [open, toggle] = useSectionOpen(storageKey, defaultOpen);
  // Derived during render (not an effect) so the body mounts in the same commit
  // as the open; it then stays mounted so reopening never remounts it.
  const [seen, setSeen] = useState(false);
  if (open && !seen) setSeen(true);
  const bodyRef = useAnimatedCollapse<HTMLDivElement>(open);

  // A measured spring on the body's height, not CSS grid rows: `0fr` ↔
  // `max-content` can't be interpolated, so the card used to sit still for
  // half the transition and then snap. Not Framer `height: "auto"` either —
  // Everyday (and Reminders) nest pills inside this body, and measuring
  // auto-height while those layout projections ran threw React #185.
  return (
    <section
      id={id}
      className={cn(
        // `self-start` + content-sized height so the open body cannot resolve
        // against a stretched min-height ancestor and pad a blank region.
        "h-auto min-h-0 w-full self-start overflow-hidden rounded-lg border border-line/80 bg-surface",
        ANCHOR_OFFSET,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="press-none group flex w-full items-start justify-between gap-3 p-4 text-left transition-colors duration-[var(--motion-micro)] active:bg-surface-sunken sm:p-5"
      >
        <CardHeading title={title} sub={sub} subMinLines={2} />
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 0 : -90 }}
          transition={motionTokens.spring}
          className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors group-hover:bg-surface-sunken group-hover:text-ink"
        >
          <ChevronDown className="h-4 w-4" strokeWidth={2} />
        </motion.span>
      </button>

      <div
        ref={bodyRef}
        data-open={open}
        // The class covers the first paint (before the hook takes over the
        // inline height) so a closed card never flashes open.
        className="overflow-hidden data-[open=false]:h-0"
        // Closed sections stay in the tree (so open/close doesn't remount
        // import controls) but must not take focus.
        inert={open ? undefined : true}
      >
        {/* `contain: paint` keeps a collapsed card's content from stretching the
            page: overflow:hidden alone still lets it count toward scroll height. */}
        <div className="min-h-0 overflow-hidden [contain:paint]">
          <div className="flex flex-col gap-4 border-t border-line/60 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
            {lazy && !open && !seen ? null : children}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Remembered open/closed state for a settings section.
 *
 * First visit (no stored preference) uses `defaultOpen`. After the user toggles
 * a section, that choice is kept in localStorage and reused forever.
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

function seedSectionOpen(key: string, defaultOpen: boolean): boolean {
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
}

function useSectionOpen(storageKey: string, defaultOpen: boolean): [boolean, () => void] {
  const key = sectionKey(storageKey);
  // Seed before subscribe so getSnapshot stays pure (no Map writes while React
  // is comparing snapshots — that path can thrash into max update depth).
  if (typeof window !== "undefined") seedSectionOpen(key, defaultOpen);

  const open = useSyncExternalStore(
    subscribeSections,
    () => sectionOpen.get(key) ?? defaultOpen,
    () => defaultOpen,
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

/** Opens a section (for deep links). Returns whether it was already open. */
function openSection(storageKey: string): boolean {
  const key = sectionKey(storageKey);
  if (sectionOpen.get(key)) return true;
  sectionOpen.set(key, true);
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage disabled */
  }
  for (const listener of sectionListeners) listener();
  return false;
}

/**
 * The one control behind both halves of "your class is about to start": the
 * Today countdown card and the reminder notification. A fixed four-column grid
 * rather than a scrolling segmented row, so every option is reachable and
 * evenly sized at phone width, and the summary line underneath spells out what
 * the pick actually does — the countdown and the alert are the same number, and
 * that's easy to miss from a grid of bare durations.
 */
function ClassReminderPicker({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const options: number[] = [...CLASS_REMINDER_OPTIONS];
  if (!options.includes(minutes)) options.push(minutes);
  options.sort((a, b) => a - b);
  const { containerRef, pillRef, moveTo } = useSlidingPill(String(minutes));

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label="Class heads-up timing"
        className="relative grid grid-cols-4 gap-1 rounded-xl border border-line/80 bg-surface-sunken/40 p-1"
      >
        <span ref={pillRef} aria-hidden className="sliding-pill rounded-lg bg-accent" />
        {options.map((opt) => {
          const active = opt === minutes;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              data-pill-key={String(opt)}
              onClick={(e) => {
                if (!active) moveTo(e.currentTarget);
                onChange(opt);
              }}
              className={cn(
                "press-none relative min-h-10 rounded-lg px-2 text-[13px] font-medium transition-colors duration-[var(--motion-micro)]",
                "text-ink-soft hover:text-ink data-[pill-on]:text-accent-ink",
              )}
            >
              <span className="relative z-[1] whitespace-nowrap">
                {classReminderOptionLabel(opt)}
              </span>
            </button>
          );
        })}
      </div>
      <AnimatePresence initial={false} mode="wait">
        <motion.p
          key={minutes}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{
            default: motionTokens.nudge,
            opacity: { duration: motionTokens.micro, ease: motionTokens.ease },
          }}
          className="px-0.5 text-[12.5px] leading-relaxed text-ink-faint"
        >
          {minutes > 0 ? (
            <>
              A “class starts soon” alert {classReminderLabel(minutes).toLowerCase()}, and the
              countdown card appears on Today at the same moment.
            </>
          ) : (
            <>No class alert, and no countdown card until the class is under way.</>
          )}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
