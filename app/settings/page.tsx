"use client";

import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { useDatebookStore } from "@/lib/store";
import { presetMeta, presetOrder } from "@/lib/theme-presets";
import { ToggleSwitch } from "@/components/toggle-switch";
import { ImportCalendar } from "@/components/import-calendar";
import { AccountSection } from "@/components/account-section";
import { NotificationToggle } from "@/components/notification-toggle";
import { serializeIcs } from "@/lib/ics";
import { cn } from "@/lib/utils";
import { motion as motionTokens } from "@/lib/motion";
import type { AppearancePreset, Density, LandingView } from "@/lib/types";

export default function SettingsPage() {
  const settings = useDatebookStore((s) => s.settings);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const categories = useDatebookStore((s) => s.categories);
  const addCategory = useDatebookStore((s) => s.addCategory);
  const updateCategory = useDatebookStore((s) => s.updateCategory);
  const deleteCategory = useDatebookStore((s) => s.deleteCategory);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#7C6CFF");

  // Paint the theme this frame — the store write and the debounced cloud sync
  // catch up after, and don't need to gate the visual change.
  const applyPreset = (preset: AppearancePreset) => {
    document.documentElement.setAttribute("data-preset", preset);
    updateSettings({ preset });
  };

  return (
    <div className="flex max-w-[640px] flex-col gap-10">
      <header>
        <h1 className="font-display text-[28px] italic text-ink">Settings</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">Make Datebook feel like yours.</p>
      </header>

      <Section title="Account & sync" sub="Sign in to save your calendar to the cloud and keep every device in sync.">
        <AccountSection />
      </Section>

      <Section
        title="Appearance"
        sub="Pick a starting point — every color in the app derives from this."
        collapsible
        storageKey="appearance"
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
      </Section>

      <Section title="Layout & display">
        <Row label="Default view">
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
        </Row>
        <Row label="Density">
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
        </Row>
        <Row label="Week starts on">
          <Segmented
            segmentId="week-starts"
            value={String(settings.weekStartsOn)}
            options={[
              { value: "0", label: "Sunday" },
              { value: "1", label: "Monday" },
            ]}
            onChange={(v) => updateSettings({ weekStartsOn: Number(v) as 0 | 1 })}
          />
        </Row>
        <Row label="24-hour clock" horizontal>
          <ToggleSwitch checked={settings.clock24h} onChange={(v) => updateSettings({ clock24h: v })} label="24-hour clock" />
        </Row>
        <Row label="Show location on event cards" horizontal>
          <ToggleSwitch checked={settings.showLocation} onChange={(v) => updateSettings({ showLocation: v })} label="Show location" />
        </Row>
        <Row label="Show category dots" horizontal>
          <ToggleSwitch checked={settings.showCategoryDot} onChange={(v) => updateSettings({ showCategoryDot: v })} label="Show category dots" />
        </Row>
        <Row label="Hide completed items" horizontal>
          <ToggleSwitch checked={settings.hideCompleted} onChange={(v) => updateSettings({ hideCompleted: v })} label="Hide completed" />
        </Row>
      </Section>

      <Section title="Categories" sub="Each category's color drives its cards, chips, and calendar dots.">
        <div className="flex flex-col gap-2">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
              <input
                type="color"
                value={cat.color}
                onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
                className="h-6 w-6 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
                aria-label={`${cat.name} color`}
              />
              <input
                value={cat.name}
                onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink focus:outline-none"
              />
              {cat.archived && <span className="text-[11px] text-ink-faint">Archived</span>}
              <button
                type="button"
                onClick={() => updateCategory(cat.id, { archived: !cat.archived })}
                className="text-[12px] font-medium text-ink-faint hover:text-ink"
              >
                {cat.archived ? "Unarchive" : "Archive"}
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
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5">
          <input
            type="color"
            value={newCategoryColor}
            onChange={(e) => setNewCategoryColor(e.target.value)}
            className="h-6 w-6 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
            aria-label="New category color"
          />
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            disabled={!newCategoryName.trim()}
            onClick={() => {
              addCategory({ name: newCategoryName.trim(), color: newCategoryColor });
              setNewCategoryName("");
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
            aria-label="Add category"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </Section>

      <Section
        title="Import from a calendar link"
        sub="Paste a feed URL from Canvas, Google Calendar, or Outlook to pull in assignments and events — due dates, titles, and descriptions. Re-sync any time to pick up changes."
      >
        <ImportCalendar />
      </Section>

      <Section title="Export" sub="Download your calendar as an .ics file you can open in Google Calendar, Outlook, or Apple Calendar.">
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
          className="self-start rounded-lg border border-line px-3.5 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          Download .ics
        </button>
      </Section>

      <Section
        title="Reminders"
        sub="Datebook alerts you before an event starts or an assignment is due. Reminders fire while the app is open and catch up on anything missed when you reopen it."
      >
        <NotificationToggle />
        <div className="mt-1">
          <p className="text-[12px] font-medium uppercase tracking-wider text-ink-faint">
            Applied by default
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Added automatically when the quick-add bar doesn&apos;t catch a reminder itself.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
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
                  "flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] transition-colors",
                  active ? "border-accent/40 bg-accent-soft text-ink" : "border-line bg-surface text-ink-soft hover:border-line-strong"
                )}
              >
                {rp.label}
                {active && <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  sub,
  children,
  collapsible = false,
  storageKey,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  storageKey?: string;
}) {
  const key = storageKey ? `datebook-section:${storageKey}` : null;
  const [open, setOpen] = useState(() => {
    if (!collapsible || !key) return true;
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });

  const toggle = () =>
    setOpen((prev) => {
      const next = !prev;
      if (key) {
        try {
          localStorage.setItem(key, next ? "1" : "0");
        } catch {
          /* storage disabled — collapse still works, it just won't persist */
        }
      }
      return next;
    });

  const heading = (
    <>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {sub && <p className="mt-0.5 text-[13px] text-ink-soft">{sub}</p>}
    </>
  );

  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="group flex w-full items-start justify-between gap-3 text-left"
        >
          <span className="min-w-0">{heading}</span>
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:text-ink",
              !open && "-rotate-90"
            )}
            strokeWidth={2}
          />
        </button>
      ) : (
        heading
      )}

      {(!collapsible || open) && (
        <div className="mt-3.5 flex flex-col gap-3">{children}</div>
      )}
    </section>
  );
}

function Row({
  label,
  children,
  horizontal = false,
}: {
  label: string;
  children: React.ReactNode;
  horizontal?: boolean;
}) {
  return (
    <div
      className={cn(
        horizontal
          ? "flex flex-row items-center justify-between gap-4"
          : "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      )}
    >
      <span className="text-[13.5px] text-ink">{label}</span>
      {children}
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
    <div className="flex w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface p-0.5 sm:w-auto">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "press-none relative min-h-9 flex-1 rounded-md px-2.5 text-[12px] font-medium transition-colors sm:flex-none",
              active ? "text-accent-ink" : "text-ink-soft hover:text-ink"
            )}
            aria-pressed={active}
          >
            {active && (
              <motion.span
                layoutId={`settings-segment-${segmentId}`}
                className="absolute inset-0 rounded-md bg-accent"
                transition={motionTokens.spring}
              />
            )}
            <span className="relative z-[1]">{opt.label}</span>
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
      layout
      onClick={onSelect}
      transition={motionTokens.spring}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border p-3 text-left transition-[border-color,box-shadow]",
        active ? "border-accent shadow-[var(--shadow-sm)]" : "border-line hover:border-line-strong"
      )}
    >
      <div className="flex overflow-hidden rounded-md border border-line">
        {meta.swatch.map((c, i) => (
          <span key={i} className="h-8 flex-1" style={{ background: c }} />
        ))}
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          {meta.label}
          {active && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">{meta.description}</p>
      </div>
    </motion.button>
  );
}
