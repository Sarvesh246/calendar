"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A timeout that stops counting while it is held.
 *
 * An undo toast that drains away under your thumb — or under the cursor on
 * its way to Undo — takes the one action it exists for with it. Holding
 * (pointer over or on it, or focus inside it) freezes the clock; letting go
 * resumes from where it stopped rather than starting over. A new `key`
 * (another undoable action) starts a fresh window.
 */
export function usePausableTimeout(key: unknown, ms: number, onDone: () => void) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const remaining = useRef(ms);
  const startedAt = useRef(0);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });

  // Declared before the timer so a new key resets the window first.
  useEffect(() => {
    remaining.current = ms;
  }, [key, ms]);

  useEffect(() => {
    if (key == null || held) return;
    startedAt.current = performance.now();
    const timer = window.setTimeout(() => done.current(), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [key, held]);

  return {
    held,
    holdProps: {
      // Pointer enter/leave covers both a hovering mouse and a finger resting
      // on a touch screen (enter on press, leave after lift).
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      },
    },
  };
}
