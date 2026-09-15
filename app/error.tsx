"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[datebook error boundary]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-[28rem] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-[28px] italic leading-tight text-ink">Something went wrong.</h1>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        Datebook hit an unexpected error. Anything already saved on this device is still here.
      </p>
      {process.env.NODE_ENV === "development" && error?.message ? (
        <pre className="max-w-full overflow-x-auto rounded-lg border border-line bg-surface-sunken px-3 py-2 text-left text-[11px] text-warn">
          {error.message}
        </pre>
      ) : null}
      <button
        onClick={reset}
        className="mt-2 rounded-lg bg-accent px-4 py-2.5 text-[13.5px] font-medium text-accent-ink"
      >
        Try again
      </button>
    </div>
  );
}
