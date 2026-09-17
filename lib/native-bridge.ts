"use client";

import { useEffect } from "react";

/**
 * Talks to the Calendar-ios WebView wrapper (see that repo's App.tsx). Every
 * call here is a harmless no-op in a plain browser — only DatebookNativeApp
 * installs `window.ReactNativeWebView` and answers these message types.
 */

type BridgeMessage = { type: string; payload?: unknown };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    __datebookBridge?: { dispatch: (message: BridgeMessage) => void };
  }
}

/** Mirrors the marker Calendar-ios appends via `applicationNameForUserAgent`. */
export function isNativeWrapper() {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("DatebookNativeApp");
}

export function postToNative(type: string, payload?: unknown) {
  if (typeof window === "undefined" || !window.ReactNativeWebView) return;
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
  } catch {
    /* ignore */
  }
}

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

function dispatch(message: BridgeMessage) {
  const set = listeners.get(message.type);
  if (!set) return;
  for (const fn of set) fn(message.payload);
}

if (typeof window !== "undefined") {
  // Native calls `webviewRef.current.injectJavaScript` to reach this.
  window.__datebookBridge = { dispatch };
}

function onNativeMessage(type: string, fn: Listener) {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

/** Subscribes a component to a message type native pushes down. */
export function useNativeMessage(type: string, fn: Listener) {
  useEffect(() => {
    const unsubscribe = onNativeMessage(type, fn);
    return () => {
      unsubscribe();
    };
  }, [type, fn]);
}
