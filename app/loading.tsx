export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-16 rounded bg-line/80" />
        <div className="h-7 w-48 rounded bg-line" />
        <div className="h-3 w-36 rounded bg-line/70" />
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 h-3 w-20 rounded bg-line/80" />
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="aspect-square rounded-md bg-surface-sunken" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 rounded bg-line/80" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-3">
            <div className="h-5 w-5 shrink-0 rounded-full bg-surface-sunken" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-3/5 max-w-[220px] rounded bg-line" />
              <div className="h-3 w-2/5 max-w-[140px] rounded bg-line/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
