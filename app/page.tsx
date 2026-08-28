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

  return null;
}
