"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { clockFace, formatClockFace, isRunning, isSessionLive } from "@/lib/focus-session";
import { openFocusRoom, useFocusSessionStore } from "@/lib/focus-session-store";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";

function useTick(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled]);
  return now;
}

export function FocusSessionHydrator() {
  const hydrate = useFocusSessionStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

export function FocusSessionChip({ className }: { className?: string }) {
  const router = useRouter();
  const session = useFocusSessionStore((s) => s.session);
  const focusMode = useUIStore((s) => s.focusMode);
  const pause = useFocusSessionStore((s) => s.pause);
  const resume = useFocusSessionStore((s) => s.resume);
  const endSession = useFocusSessionStore((s) => s.endSession);
  const items = useDatebookStore((s) => s.items);
  const live = isSessionLive(session) && !focusMode;
  const now = useTick(live);
  const [menu, setMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  if (!session || !live) return null;

  const item = items.find((i) => i.id === session.activeItemId);
  const running = isRunning(session);
  const face = clockFace(session, now);
  const time = formatClockFace(face);
  const title = item?.title ?? "Focus";

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", className)}>
      <div className="flex overflow-hidden rounded-full border border-line bg-surface text-[12.5px] font-medium text-ink shadow-sm">
        <button
          type="button"
          onClick={() => {
            haptic("light");
            openFocusRoom(undefined, router);
          }}
          className="flex min-h-9 max-w-[14rem] items-center gap-1.5 px-3 text-left hover:bg-surface-sunken"
          aria-label={`Return to Focus, ${title}, ${time}`}
        >
          <span className="tabular-nums text-ink">Focus · {time}</span>
          <span className="min-w-0 truncate text-ink-soft">{title}</span>
        </button>
        <button
          type="button"
          aria-expanded={menu}
          aria-haspopup="menu"
          aria-label="Focus session actions"
          onClick={() => setMenu((o) => !o)}
          className="flex min-h-9 w-9 items-center justify-center border-l border-line text-ink-soft hover:bg-surface-sunken hover:text-ink"
        >
          <span className="text-[11px]" aria-hidden>
            ▾
          </span>
        </button>
      </div>
      {menu && (
        <div
          role="menu"
          className="absolute right-0 z-[40] mt-1 w-44 rounded-xl border border-line bg-surface p-1 shadow-[0_16px_40px_-14px_rgb(0_0_0/0.35)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              haptic("light");
              if (running) pause();
              else resume();
              setMenu(false);
            }}
            className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-surface-sunken"
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              haptic("light");
              endSession();
              setMenu(false);
            }}
            className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-warn hover:bg-warn-soft"
          >
            <X className="h-3.5 w-3.5" />
            End session
          </button>
        </div>
      )}
    </div>
  );
}
