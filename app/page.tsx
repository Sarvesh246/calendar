"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDatebookStore } from "@/lib/store";
import { sanitizeSettings } from "@/lib/sanitize-store";
import type { LandingView } from "@/lib/types";

const LANDING: LandingView[] = ["today", "calendar", "agenda"];

function landingRoute(): string {
  const view = sanitizeSettings(useDatebookStore.getState().settings).landingView;
  return LANDING.includes(view) ? `/${view}` : "/today";
}

/** The boot splash in the shell is the launch face. This route only waits
 *  for hydration and then hands off to the landing tab. */
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

  return <div className="min-h-[40vh]" aria-hidden />;
}
