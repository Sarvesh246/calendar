"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ListTodo, Sparkles } from "lucide-react";
import { DayAgenda } from "@/components/day-agenda";
import { PlanningTray } from "@/components/calendar/planning-tray";
import {
  clampPaneWidth,
  PANE_DEFAULT_WIDTH,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTH,
  useWorkspacePrefs,
  type CalendarMode,
  type PaneTab,
} from "@/lib/workspace-prefs";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const loadAssistant = () =>
  import("@/components/assistant-conversation").then((m) => ({ default: m.AssistantConversation }));

const AssistantConversation = dynamic(loadAssistant, {
    ssr: false,
    loading: () => (
      <div role="status" className="flex flex-1 items-center justify-center text-[12px] text-ink-faint">
        Loading assistant…
      </div>
    ),
  }
);

const TABS: { id: PaneTab; label: string; Icon: typeof CalendarDays }[] = [
  { id: "day", label: "Day", Icon: CalendarDays },
  { id: "plan", label: "To place", Icon: ListTodo },
  { id: "assistant", label: "Assistant", Icon: Sparkles },
];

/** One tab's content. Hidden panels stay mounted (and keep their scroll). */
function PanePanel({
  id,
  show,
  className,
  children,
}: {
  id: PaneTab;
  show: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`pane-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`pane-tab-${id}`}
      hidden={!show}
      className={cn("min-h-0 flex-1 flex-col", show && "tab-page-enter flex", className)}
    >
      {children}
    </div>
  );
}

/** Never let the pane take more than this share of the window. */
const MAX_VIEWPORT_SHARE = 0.45;

function maxForViewport() {
  return Math.max(PANE_MIN_WIDTH, Math.min(PANE_MAX_WIDTH, Math.floor(window.innerWidth * MAX_VIEWPORT_SHARE)));
}

/**
 * The calendar's right-hand workspace: the selected day, the planning tray, or
 * the assistant — one at a time, so the grid is never squeezed between panels.
 * Its left edge drags to resize (or arrow keys on the focused divider); the
 * width is remembered per device.
 */
export function WorkspacePane({
  selectedDate,
  selectedItems,
  items,
  mode,
  onAdd,
  onSwitchToWeek,
}: {
  selectedDate: Date;
  selectedItems: Item[];
  items: Item[];
  mode: CalendarMode;
  onAdd: () => void;
  onSwitchToWeek: () => void;
}) {
  const width = useWorkspacePrefs((s) => s.paneWidth);
  const setWidth = useWorkspacePrefs((s) => s.setPaneWidth);
  const tab = useWorkspacePrefs((s) => s.paneTab);
  const setTab = useWorkspacePrefs((s) => s.setPaneTab);
  const asideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number; latest: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));

  // Panels seen so far this session. Grown during render (not in an effect) so
  // the first visit mounts in the same commit that flips the tab.
  const [visited, setVisited] = useState<ReadonlySet<PaneTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));

  // Fetch the assistant's chunk while idle so its first open isn't a network
  // wait stacked on top of the switch.
  useEffect(() => {
    const load = () => void loadAssistant();
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(load, 1500);
    return () => clearTimeout(id);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !asideRef.current) return;
    e.preventDefault();
    const current = asideRef.current.getBoundingClientRect().width;
    drag.current = { x: e.clientX, width: current, latest: current };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
    document.documentElement.classList.add("pane-resizing");
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const el = asideRef.current;
    if (!d || !el) return;
    // The divider is on the pane's left edge: dragging left widens it.
    const next = Math.min(maxForViewport(), clampPaneWidth(d.width + (d.x - e.clientX)));
    d.latest = next;
    el.style.width = `${next}px`;
  }

  function endResize(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setResizing(false);
    document.documentElement.classList.remove("pane-resizing");
    setWidth(d.latest);
  }

  function nudge(next: number) {
    const clamped = Math.min(maxForViewport(), clampPaneWidth(next));
    if (asideRef.current) asideRef.current.style.width = `${clamped}px`;
    setWidth(clamped);
  }

  function onDividerKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 24;
    const current = asideRef.current?.getBoundingClientRect().width ?? width;
    let handled = true;
    if (e.key === "ArrowLeft") nudge(current + step);
    else if (e.key === "ArrowRight") nudge(current - step);
    else if (e.key === "Home") nudge(PANE_MIN_WIDTH);
    else if (e.key === "End") nudge(PANE_MAX_WIDTH);
    else if (e.key === "Enter") useWorkspacePrefs.getState().setPaneCollapsed(true);
    else handled = false;
    if (handled) e.preventDefault();
  }

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(index + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`pane-tab-${next.id}`)?.focus();
  }

  return (
    <aside
      ref={asideRef}
      aria-label="Side panel"
      style={{ width, maxWidth: `${MAX_VIEWPORT_SHARE * 100}vw`, minWidth: PANE_MIN_WIDTH }}
      className="relative flex h-full max-h-full min-h-0 shrink-0 flex-col self-stretch"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        aria-valuemin={PANE_MIN_WIDTH}
        aria-valuemax={PANE_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        data-active={resizing || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => nudge(PANE_DEFAULT_WIDTH)}
        onKeyDown={onDividerKey}
        className="pane-resize-handle absolute -left-[13px] top-0 z-10 h-full w-[10px] cursor-col-resize touch-none rounded-full focus-visible:outline-none"
      />

      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="shrink-0 border-b border-line p-1.5">
          <div role="tablist" aria-label="Side panel content" className="relative flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
            {/* One pill that slides with a CSS transform. It runs on the
                compositor, so it keeps gliding even while the next panel mounts
                — a JS layout animation froze mid-slide on that same frame. */}
            <span
              aria-hidden
              className="pane-tab-pill pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
              style={{
                width: `calc((100% - 4px - ${(TABS.length - 1) * 2}px) / ${TABS.length})`,
                transform: `translateX(calc(${activeIndex} * (100% + 2px)))`,
              }}
            />
            {TABS.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  id={`pane-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`pane-panel-${id}`}
                  tabIndex={active ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => {
                    if (active) return;
                    haptic("light");
                    setTab(id);
                  }}
                  className={cn(
                    "press-none relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium",
                    "transition-colors duration-[var(--motion-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    active ? "text-ink" : "text-ink-soft hover:text-ink"
                  )}
                >
                  <Icon className={cn("relative z-[1] h-3.5 w-3.5", id === "assistant" && "text-accent")} strokeWidth={1.9} />
                  <span className="relative z-[1]">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* A panel mounts on its first visit and then stays, hidden, so
              switching back is a display toggle instead of a rebuild. */}
          {visited.has("day") && (
            <PanePanel id="day" show={tab === "day"} className="p-4">
              <DayAgenda className="min-h-0 flex-1" date={selectedDate} items={selectedItems} onAdd={onAdd} />
            </PanePanel>
          )}
          {visited.has("plan") && (
            <PanePanel id="plan" show={tab === "plan"}>
              <PlanningTray items={items} mode={mode} onSwitchToWeek={onSwitchToWeek} />
            </PanePanel>
          )}
          {visited.has("assistant") && (
            <PanePanel id="assistant" show={tab === "assistant"}>
              <AssistantConversation variant="docked" active={tab === "assistant"} />
            </PanePanel>
          )}
        </div>
      </div>
    </aside>
  );
}
