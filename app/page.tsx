"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDatebookStore } from "@/lib/store";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const persist = useDatebookStore.persist;
    const go = () => {
      router.replace(`/${useDatebookStore.getState().settings.landingView}`);
    };
    if (persist.hasHydrated()) {
      go();
      return;
    }
    return persist.onFinishHydration(go);
  }, [router]);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-8 w-56 animate-pulse rounded bg-surface-sunken" />
      </div>
      <div className="h-32 animate-pulse rounded-xl border border-line bg-surface-sunken" />
    </div>
  );
}
