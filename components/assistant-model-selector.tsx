"use client";

import { useEffect } from "react";
import { useAssistantModelStore } from "@/lib/assistant-models";
import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";

export function AssistantModelSelector({
  compact = false,
  centered = false,
}: {
  compact?: boolean;
  centered?: boolean;
}) {
  const models = useAssistantModelStore((state) => state.models);
  const selectedId = useAssistantModelStore((state) => state.selectedId);
  const loading = useAssistantModelStore((state) => state.loading);
  const load = useAssistantModelStore((state) => state.load);
  const select = useAssistantModelStore((state) => state.select);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SelectMenu
      label="Assistant model"
      value={selectedId}
      onChange={select}
      align={centered ? "center" : "right"}
      options={[
        { value: "auto", label: loading && models.length === 0 ? "Checking models…" : "Auto" },
        ...models.map((model) => ({ value: model.id, label: model.label })),
      ]}
      className={
        centered
          ? "w-[min(140px,calc(100vw-210px))]"
          : compact
            ? "max-w-40"
            : "w-[min(34vw,140px)] md:w-48"
      }
      buttonClassName={cn(
        "h-9 rounded-xl border border-line bg-surface-sunken px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint focus-visible:border-accent",
        compact && "h-8 text-[12px]",
      )}
    />
  );
}
