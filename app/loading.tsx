export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-8 w-56 animate-pulse rounded bg-surface-sunken" />
        <div className="h-4 w-40 animate-pulse rounded bg-surface-sunken" />
      </div>
      <div className="h-32 animate-pulse rounded-xl border border-line bg-surface-sunken" />
      <div className="flex flex-col gap-2">
        <div className="h-4 w-20 animate-pulse rounded bg-surface-sunken" />
        <div className="h-16 animate-pulse rounded-xl border border-line bg-surface-sunken" />
        <div className="h-16 animate-pulse rounded-xl border border-line bg-surface-sunken" />
      </div>
    </div>
  );
}
