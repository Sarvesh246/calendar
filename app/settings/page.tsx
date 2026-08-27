"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { presetMeta, presetOrder } from "@/lib/theme-presets";
import { ToggleSwitch } from "@/components/toggle-switch";
import { cn } from "@/lib/utils";
import type { AppearancePreset, Density, LandingView } from "@/lib/types";

export default function SettingsPage() {
  const settings = useDatebookStore((s) => s.settings);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const categories = useDatebookStore((s) => s.categories);
  const addCategory = useDatebookStore((s) => s.addCategory);
  const updateCategory = useDatebookStore((s) => s.updateCategory);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#7C6CFF");

  return (
    <div className="flex max-w-[640px] flex-col gap-10">
      <header>
        <h1 className="font-display text-[28px] italic text-ink">Settings</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">Make Datebook feel like yours.</p>
      </header>

      <Section title="Appearance" sub="Pick a starting point — every color in the app derives from this.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {presetOrder.map((preset) => (
            <PresetCard
              key={preset}
              preset={preset}
              active={settings.preset === preset}
              onSelect={() => updateSettings({ preset })}
            />
          ))}
        </div>
      </Section>

      <Section title="Layout & display">
        <Row label="Default view">
          <Segmented
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
            value={settings.density}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
              { value: "spacious", label: "Spacious" },
            ]}
            onChange={(v) => updateSettings({ density: v as Density })}
          />
        </Row>
        <Row label="Week starts on">
          <Segmented
            value={String(settings.weekStartsOn)}
            options={[
              { value: "0", label: "Sunday" },
              { value: "1", label: "Monday" },
            ]}
            onChange={(v) => updateSettings({ weekStartsOn: Number(v) as 0 | 1 })}
          />
        </Row>
        <Row label="24-hour clock">
          <ToggleSwitch checked={settings.clock24h} onChange={(v) => updateSettings({ clock24h: v })} label="24-hour clock" />
        </Row>
        <Row label="Show location on event cards">
          <ToggleSwitch checked={settings.showLocation} onChange={(v) => updateSettings({ showLocation: v })} label="Show location" />
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
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
            aria-label="Add category"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </Section>

      <Section title="Default reminders" sub="Applied automatically when the quick-add bar doesn't catch a reminder itself.">
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

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {sub && <p className="mt-0.5 text-[13px] text-ink-soft">{sub}</p>}
      <div className="mt-3.5 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13.5px] text-ink">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            value === opt.value ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
          )}
        >
          {opt.label}
        </button>
      ))}
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
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border p-3 text-left transition-all",
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
    </button>
  );
}
