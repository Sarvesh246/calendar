import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:opacity-90",
        secondary: "border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
        tertiary: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
        destructive: "text-warn hover:bg-warn-soft",
        fab: "rounded-full bg-accent text-accent-ink shadow-[var(--shadow-lg)] hover:opacity-90",
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
