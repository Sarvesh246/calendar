import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  sub,
  action,
  className,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 py-8", className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {sub && <p className="text-sm text-ink-soft">{sub}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
