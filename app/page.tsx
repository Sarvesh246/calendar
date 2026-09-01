"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useDatebookStore } from "@/lib/store";
import { sanitizeSettings } from "@/lib/sanitize-store";
import type { LandingView } from "@/lib/types";

const LANDING: LandingView[] = ["today", "calendar", "agenda"];

function landingRoute(): string {
  const view = sanitizeSettings(useDatebookStore.getState().settings).landingView;
  return LANDING.includes(view) ? `/${view}` : "/today";
}

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const persist = useDatebookStore.persist;
    const go = () => {
      router.replace(landingRoute());
    };
    if (persist.hasHydrated()) {
      go();
      return;
    }
    return persist.onFinishHydration(go);
  }, [router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Image
        src="/icon-192.png"
        alt=""
        width={72}
        height={72}
        priority
        className="rounded-[18px] shadow-md animate-[pulse_1.8s_ease-in-out_infinite]"
      />
      <p className="text-[20px] italic text-ink-soft">Datebook</p>
    </div>
  );
}
