import { cn } from "@/lib/utils";

export function CategoryDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full shrink-0", className)}
      style={{ background: color }}
    />
  );
}
