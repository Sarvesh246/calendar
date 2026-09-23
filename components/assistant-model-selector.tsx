"use client";

import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useAssistantModelStore } from "@/lib/assistant-models";
import { cn } from "@/lib/utils";

export function AssistantModelSelector({ compact = false }: { compact?: boolean }) {
  const models = useAssistantModelStore((state) => state.models);
  const selectedId = useAssistantModelStore((state) => state.selectedId);
  const loading = useAssistantModelStore((state) => state.loading);
  const load = useAssistantModelStore((state) => state.load);
  const select = useAssistantModelStore((state) => state.select);

  useEffect(() => {
    void load();
    // Retry when the app returns to the foreground if the list came back empty.
    const retry = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("focus", retry);
    return () => {
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("focus", retry);
    };
  }, [load]);

  return (
    <label className={cn("assistant-web-model-selector relative block min-w-0", compact ? "max-w-40" : "w-[min(48vw,190px)] md:w-48")}>
      <span className="sr-only">Assistant model</span>
      <select
        aria-label="Assistant model"
        value={selectedId}
        onChange={(event) => select(event.target.value)}
        className={cn(
          "h-8 w-full appearance-none truncate rounded-lg border border-line bg-surface-sunken pl-2.5 pr-7 text-[11.5px] font-medium text-ink-soft outline-none transition-colors hover:border-ink-faint focus:border-accent",
          compact && "h-7 text-[11px]"
        )}
      >
        <option value="auto">{loading && models.length === 0 ? "Checking models…" : "Auto"}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
    </label>
  );
}
