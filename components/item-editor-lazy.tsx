"use client";

import type { ComponentProps } from "react";
import type { ItemEditor as ItemEditorType } from "@/components/item-editor";
import { lazyComponent } from "@/lib/lazy-component";
import { registerWarmUp } from "@/lib/warm-chunks";

function EditorPlaceholder() {
  return (
    <div role="status" className="mt-3 space-y-3 border-t border-line pt-3">
      <span className="sr-only">Loading item details…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="h-9 rounded-md bg-surface-sunken" />
      ))}
    </div>
  );
}

/**
 * The item editor, split out of the first load but warmed while idle — one
 * shared instance so the card, the day sheet and the inspector all hit the
 * same loaded module and none of them flashes a placeholder on open.
 */
export const ItemEditor = lazyComponent<ComponentProps<typeof ItemEditorType>>(
  () => import("@/components/item-editor").then((m) => m.ItemEditor),
  EditorPlaceholder
);
registerWarmUp(ItemEditor.preload);
