"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { presetMeta } from "@/lib/theme-presets";
import {
  buildCustomThemeVars,
  customThemeColorScheme,
  normalizeThemeHex,
  type CustomThemeColors,
} from "@/lib/custom-theme";
import { cn } from "@/lib/utils";
import { motion as motionTokens } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import type { AppearancePreset } from "@/lib/types";

export function PresetCard({
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
        active ? "border-accent" : "border-line/80 hover:border-line-strong",
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

export function CustomPresetCard({
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
        active ? "border-accent" : "border-line/80 hover:border-line-strong",
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

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // A new value from outside (a preset, a reset) replaces whatever was typed.
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setDraft(value);
  }

  function emit(raw: string) {
    const next = normalizeThemeHex(raw);
    if (!next) return;
    setDraft(next);
    onChange(next);
  }

  function commit() {
    const next = normalizeThemeHex(draft);
    if (next) onChange(next);
    else setDraft(value);
  }

  return (
    <label className="field-shell flex items-center gap-2.5 rounded-xl border border-line/80 bg-surface px-3 py-2.5">
      <input
        type="color"
        value={normalizeThemeHex(value) ?? value}
        onInput={(e) => emit(e.currentTarget.value)}
        onChange={(e) => emit(e.currentTarget.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
        aria-label={`${label} color`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
          {label}
        </span>
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

export function CustomThemeEditor({
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
        <ColorField
          label="Surface"
          value={colors.surface}
          onChange={(v) => onChange({ ...colors, surface: v })}
        />
        <ColorField
          label="Accent"
          value={colors.accent}
          onChange={(v) => onChange({ ...colors, accent: v })}
        />
      </div>

      {/* Live demo — scoped to these exact derived tokens, not just the three
          raw picks, so it shows what the app will actually look like. */}
      <div
        style={{
          background: vars["--surface-base"],
          borderColor: vars["--line"],
          colorScheme: scheme,
        }}
        className="overflow-hidden rounded-xl border p-3 transition-colors duration-200"
      >
        <div className="flex items-center justify-between">
          <span
            style={{ color: vars["--ink"] }}
            className="text-[11.5px] font-semibold tracking-tight transition-colors duration-200"
          >
            Preview
          </span>
          <span
            style={{ color: vars["--ink-faint"] }}
            className="text-[10.5px] transition-colors duration-200"
          >
            Today
          </span>
        </div>

        <div
          style={{ background: vars["--surface"], borderColor: vars["--line"] }}
          className="mt-2.5 rounded-lg border p-2.5 transition-colors duration-200"
        >
          <div className="flex items-center gap-2">
            <span
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
          <p
            style={{ color: vars["--ink-soft"] }}
            className="mt-0.5 text-[11px] transition-colors duration-200"
          >
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
