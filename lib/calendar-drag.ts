"use client";

import { create } from "zustand";
import { haptic } from "./haptic";

/** Pixel height of one hour in the week grid. The drop maths reads it too. */
export const HOUR_HEIGHT = 52;

export type DropTarget =
  | { kind: "slot"; dayKey: string; minute: number }
  | { kind: "day"; dayKey: string };

export type DragTone = "move" | "create" | "plan" | "due";

/** A block drawn in the week grid showing where a drag will land. */
export interface DragPreview {
  dayKey: string;
  startMin: number;
  endMin: number;
  tone: DragTone;
  color?: string;
  title?: string;
}

interface DragState {
  /** The item being moved, so its own block can step back while it travels. */
  sourceId: string | null;
  preview: DragPreview | null;
  /** "Tue, Sep 15 · 2:30 – 3:30 PM" — follows the pointer. */
  label: string | null;
  x: number;
  y: number;
}

export const useCalendarDrag = create<DragState>(() => ({
  sourceId: null,
  preview: null,
  label: null,
  x: 0,
  y: 0,
}));

export interface DragOptions {
  accept: ("slot" | "day")[];
  sourceId?: string;
  /** How far the pointer travels before a press becomes a drag. */
  threshold?: number;
  /** Where this drag would land over `target`, or null when it can't drop there. */
  resolve: (target: DropTarget) => { preview?: DragPreview; label: string } | null;
  onDrop: (target: DropTarget) => void;
  /** The press never became a drag — treat it as a click. */
  onTap?: () => void;
}

let cancelActive: (() => void) | null = null;

function inside(r: DOMRect, x: number, y: number) {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

function hitTest(x: number, y: number, accept: DragOptions["accept"]): DropTarget | null {
  if (accept.includes("day")) {
    for (const el of document.querySelectorAll<HTMLElement>("[data-drop-day]")) {
      if (el.closest("[inert]")) continue;
      if (inside(el.getBoundingClientRect(), x, y)) {
        return { kind: "day", dayKey: el.dataset.dropDay! };
      }
    }
  }
  if (accept.includes("slot")) {
    for (const el of document.querySelectorAll<HTMLElement>("[data-drop-col]")) {
      if (el.closest("[inert]")) continue;
      const rect = el.getBoundingClientRect();
      if (!inside(rect, x, y)) continue;
      // Hours scrolled up under the sticky day header aren't a place you can
      // see, so they aren't a place you can drop.
      const scroller = el.closest<HTMLElement>("[data-drop-scroll]");
      if (scroller) {
        const clip = scroller.getBoundingClientRect();
        const sticky = scroller.querySelector<HTMLElement>("[data-drop-sticky]");
        const top = sticky ? sticky.getBoundingClientRect().bottom : clip.top;
        if (y < top || y > clip.bottom) continue;
      }
      const startHour = Number(el.dataset.startHour ?? 0);
      return {
        kind: "slot",
        dayKey: el.dataset.dropCol!,
        minute: startHour * 60 + ((y - rect.top) / HOUR_HEIGHT) * 60,
      };
    }
  }
  return null;
}

function markTarget(dayKey: string | null) {
  for (const el of document.querySelectorAll("[data-drop-active]")) el.removeAttribute("data-drop-active");
  if (!dayKey) return;
  for (const el of document.querySelectorAll(`[data-drop-day="${dayKey}"], [data-drop-head="${dayKey}"]`)) {
    el.setAttribute("data-drop-active", "");
  }
}

/** Swallow the click the browser synthesises from a drag's pointerup. */
function suppressNextClick() {
  const stop = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", stop, true);
  window.setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

/** Scroll the week grid while the pointer rests near its top or bottom edge. */
function edgeScroll(x: number, y: number): boolean {
  for (const el of document.querySelectorAll<HTMLElement>("[data-drop-scroll]")) {
    if (el.closest("[inert]")) continue;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right) continue;
    const sticky = el.querySelector<HTMLElement>("[data-drop-sticky]");
    const top = sticky ? sticky.getBoundingClientRect().bottom : r.top;
    const zone = 36;
    if (y < top + zone && el.scrollTop > 0) {
      el.scrollTop -= Math.ceil((top + zone - y) / 4);
      return true;
    }
    if (y > r.bottom - zone && el.scrollTop + el.clientHeight < el.scrollHeight) {
      el.scrollTop += Math.ceil((y - (r.bottom - zone)) / 4);
      return true;
    }
  }
  return false;
}

/**
 * Start tracking a press that may become a calendar drag. Every direct
 * manipulation in the calendar — moving a block, stretching it, sweeping out a
 * new event, carrying a chip to another day, dropping planned work into the
 * week — goes through here, so they all snap, preview, label, cancel (Esc) and
 * swallow their trailing click the same way.
 */
export function beginCalendarDrag(
  e: { clientX: number; clientY: number; pointerId: number; button: number },
  opts: DragOptions
) {
  if (e.button !== 0) return;
  cancelActive?.();

  const startX = e.clientX;
  const startY = e.clientY;
  const threshold = opts.threshold ?? 5;
  let active = false;
  let target: DropTarget | null = null;
  let lastKey = "";
  let pointer = { x: startX, y: startY };
  let raf = 0;

  const update = () => {
    const hit = hitTest(pointer.x, pointer.y, opts.accept);
    const resolved = hit ? opts.resolve(hit) : null;
    target = resolved ? hit : null;
    const key = resolved ? `${resolved.label}|${JSON.stringify(resolved.preview ?? null)}` : "";
    if (key !== lastKey) {
      if (lastKey && key) haptic("light");
      lastKey = key;
      markTarget(target?.dayKey ?? null);
      useCalendarDrag.setState({ preview: resolved?.preview ?? null, label: resolved?.label ?? null });
    }
    useCalendarDrag.setState({ x: pointer.x, y: pointer.y });
  };

  const loop = () => {
    raf = 0;
    if (!active) return;
    if (edgeScroll(pointer.x, pointer.y)) {
      update();
      raf = requestAnimationFrame(loop);
    }
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    pointer = { x: ev.clientX, y: ev.clientY };
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
      active = true;
      haptic("light");
      document.documentElement.classList.add("calendar-dragging");
      useCalendarDrag.setState({ sourceId: opts.sourceId ?? null });
    }
    ev.preventDefault();
    update();
    if (!raf) raf = requestAnimationFrame(loop);
  };

  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const wasActive = active;
    const landed = target;
    cleanup();
    if (!wasActive) {
      opts.onTap?.();
      return;
    }
    suppressNextClick();
    if (landed) {
      haptic("success");
      opts.onDrop(landed);
    }
  };

  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    cleanup();
  };

  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !active) return;
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    // The button is still held; the click it produces on release is not a tap.
    window.addEventListener("pointerup", suppressNextClick, { once: true, capture: true });
  };

  function cleanup() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (raf) cancelAnimationFrame(raf);
    markTarget(null);
    document.documentElement.classList.remove("calendar-dragging");
    if (active) useCalendarDrag.setState({ sourceId: null, preview: null, label: null });
    active = false;
    if (cancelActive === cleanup) cancelActive = null;
  }

  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  cancelActive = cleanup;
}
