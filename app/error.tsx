"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-[28rem] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-[28px] italic leading-tight text-ink">Something went wrong.</h1>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        Datebook hit an unexpected error. Anything already saved on this device is still here.
      </p>
      <button
        onClick={reset}
        className="mt-2 rounded-lg bg-accent px-4 py-2.5 text-[13.5px] font-medium text-accent-ink"
      >
        Try again
      </button>
    </div>
  );
}
