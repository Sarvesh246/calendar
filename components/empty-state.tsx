import { cn } from "@/lib/utils";

/**
 * The empty state used to be a loose icon over two lines of left-aligned text,
 * which read as a rendering failure rather than a designed state — especially
 * inside the calendar's day panel, where it sat in the middle of an otherwise
 * framed surface.
 *
 * It now gets a soft dashed enclosure and centred type, so an empty section
 * looks like a place something *goes*. `compact` is for the narrow rails, where
 * the full padding would push the message out of view. No icon, per the
 * glanceability pass that stripped decorative glyphs from these states.
 */
export function EmptyState({
  title,
  sub,
  action,
  compact = false,
  className,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line text-center",
        compact ? "px-3 py-6" : "px-4 py-8 sm:py-10",
        className
      )}
    >
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {sub && <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-ink-soft">{sub}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
