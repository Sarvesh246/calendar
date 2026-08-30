import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  // `transition-colors` alone left the shadow and any transform snapping. The
  // shared press-depress in globals.css handles scale; this adds the elevation
  // and the timing so every Button in the app moves on one curve.
  "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium " +
    "transition-[color,background-color,border-color,box-shadow,opacity,transform] " +
    "duration-[var(--motion-standard)] ease-[var(--ease-standard)] " +
    "disabled:pointer-events-none disabled:opacity-40 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-[var(--shadow-sm)] hover:opacity-90 hover:shadow-[var(--shadow-md)]",
        secondary:
          "hover-lift border border-line bg-surface text-ink-soft shadow-[var(--shadow-sm)] hover:border-line-strong hover:text-ink hover:shadow-[var(--shadow-md)]",
        tertiary: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
        destructive: "text-warn hover:bg-warn-soft",
        // The FAB is the app's most-pressed control, so it gets the most
        // physical response: it rises on hover and sinks under a finger.
        fab: "rounded-full bg-accent text-accent-ink shadow-[var(--shadow-lg)] hover:opacity-95 hover:shadow-[0_18px_44px_color-mix(in_srgb,var(--accent)_38%,transparent)] active:scale-95",
      },
      size: {
        sm: "h-9 rounded-lg px-3 text-[13px]",
        md: "min-h-11 rounded-lg px-3.5 text-[13px]",
        icon: "h-11 w-11 rounded-xl",
        iconSm: "h-9 w-9 rounded-lg",
        fab: "h-14 w-14 rounded-full",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
