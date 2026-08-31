"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return <p className="text-[13px] text-ink-soft">Datebook is installed on this device.</p>;
  }
  if (!event) {
    return (
      <p className="text-[13px] leading-relaxed text-ink-soft">
        On iPhone, open Share and tap Add to Home Screen. If you installed before a recent icon update,
        remove the old home-screen icon and add again so iOS picks up the latest tile. Chrome and Edge
        will offer an install button here when the app is installable.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        await event.prompt();
        const choice = await event.userChoice;
        if (choice.outcome === "accepted") setEvent(null);
      }}
      className="flex min-h-11 items-center gap-2 self-start rounded-lg border border-line px-3.5 text-[13px] font-medium text-ink-soft hover:text-ink"
    >
      <Download className="h-4 w-4" strokeWidth={1.9} />
      Install Datebook
    </button>
  );
}
