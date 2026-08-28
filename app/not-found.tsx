import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-[28rem] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-[28px] italic leading-tight text-ink">Page not found.</h1>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        That URL isn&apos;t part of Datebook. Head back to today.
      </p>
      <Link
        href="/today"
        className="mt-2 rounded-lg bg-accent px-4 py-2.5 text-[13.5px] font-medium text-accent-ink"
      >
        Go to Today
      </Link>
    </div>
  );
}
