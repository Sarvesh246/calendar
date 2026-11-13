"use client";

import { ToggleSwitch } from "@/components/toggle-switch";
import { cn } from "@/lib/utils";
import { useSlidingPill } from "@/lib/sliding-pill";

export function CardHeading({
  title,
  sub,
  subMinLines,
}: {
  title: string;
  sub?: string;
  /** Reserve this many subtitle lines so desktop tiles in a row match height. */
  subMinLines?: number;
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
      {sub && (
        <p
          className={cn(
            "mt-1 text-[13px] leading-relaxed text-ink-soft",
            subMinLines === 2 && "lg:min-h-[calc(2*1.625em)]",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export function Subheading({ title }: { title: string }) {
  return <p className="text-[13px] font-medium text-ink">{title}</p>;
}

export function Divider() {
  return <div className="my-1 h-px bg-line/60" role="separator" />;
}

export function SettingBlock({
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

export function ToggleRow({
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

export function Segmented({
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
  const { containerRef, pillRef, moveTo } = useSlidingPill(value);
  return (
    <div
      ref={containerRef}
      data-segment={segmentId}
      className="relative flex w-full items-stretch gap-0.5 rounded-xl border border-line/80 bg-surface-sunken/40 p-1 sm:w-fit"
    >
      <span ref={pillRef} aria-hidden className="sliding-pill rounded-lg bg-accent" />
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-pill-key={opt.value}
            onClick={(e) => {
              if (!active) moveTo(e.currentTarget);
              onChange(opt.value);
            }}
            className={cn(
              "press-none relative min-h-10 min-w-0 flex-1 rounded-lg px-0.5 text-[12px] font-medium leading-tight transition-colors duration-[var(--motion-micro)] sm:flex-none sm:px-4 sm:text-[13px]",
              "text-ink-soft hover:text-ink data-[pill-on]:text-accent-ink",
            )}
            aria-pressed={active}
          >
            <span className="relative z-[1] block [overflow-wrap:anywhere]">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
