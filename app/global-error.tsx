"use client";

import "./globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#f7f7f8] px-6 text-center text-[#18181b]">
        <h1 className="text-[28px] italic leading-tight">Datebook couldn&apos;t load.</h1>
        <p className="max-w-[28rem] text-[13.5px] leading-relaxed text-[#55555f]">
          A startup error stopped the app. Reload, or try again in a moment.
        </p>
        <button
          onClick={reset}
          className="mt-2 rounded-lg bg-[#565fc2] px-4 py-2.5 text-[13.5px] font-medium text-white"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
