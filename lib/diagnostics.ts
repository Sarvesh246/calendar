"use client";

const SETTING = "datebook-diagnostics-enabled";
const DEVICE = "datebook-diagnostics-device";
const CHANGE = "datebook-diagnostics-change";
export function diagnosticsEnabled() {
  try {
    return localStorage.getItem(SETTING) !== "false";
  } catch {
    return false;
  }
}
export function setDiagnosticsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SETTING, String(enabled));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE));
}
export function subscribeDiagnostics(callback: () => void) {
  window.addEventListener(CHANGE, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE, callback);
    window.removeEventListener("storage", callback);
  };
}
export function diagnosticsDeviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE, id);
    }
    return id;
  } catch {
    return null;
  }
}
type Metric = {
  type:
    | "interaction"
    | "event_timing"
    | "long_task"
    | "layout_shift"
    | "navigation"
    | "resource"
    | "error";
  at: number;
  route: "today" | "calendar" | "agenda" | "schedule" | "settings" | "other";
  kind?:
    | "click"
    | "pointer"
    | "key"
    | "input"
    | "other"
    | "api"
    | "document"
    | "script"
    | "style"
    | "image"
    | "error"
    | "rejection";
  action?:
    | "today"
    | "calendar"
    | "agenda"
    | "schedule"
    | "settings"
    | "assistant"
    | "search"
    | "filter"
    | "add"
    | "send"
    | "other";
  duration?: number;
  delay?: number;
  value?: number;
};
function route(): Metric["route"] {
  const part = location.pathname.split("/")[1];
  return part === "today" ||
    part === "calendar" ||
    part === "agenda" ||
    part === "schedule" ||
    part === "settings"
    ? part
    : "other";
}
const cap = (n: number) => Math.max(0, Math.min(600000, Math.round(n)));

/** No content, selectors, URLs, stack traces or network payloads leave the device. */
export function startDiagnostics() {
  if (!diagnosticsEnabled() || typeof PerformanceObserver === "undefined") return () => {};
  const device = diagnosticsDeviceId();
  if (!device) return () => {};
  const session = crypto.randomUUID();
  let queue: Metric[] = [];
  let stopped = false;
  let sending = false;
  let abort: AbortController | null = null;
  const observers: PerformanceObserver[] = [];
  const add = (metric: Omit<Metric, "at" | "route">) => {
    if (stopped) return;
    if (queue.length >= 200) queue.shift();
    queue.push({ ...metric, at: Date.now(), route: route() });
  };
  const flush = async () => {
    if (stopped || sending || !queue.length || !navigator.onLine || !diagnosticsEnabled()) return;
    sending = true;
    const events = queue.splice(0, 40);
    abort = new AbortController();
    try {
      const response = await fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device, session, events }),
        keepalive: true,
        signal: abort.signal,
      });
      if (!response.ok && !stopped) queue = [...events, ...queue].slice(-200);
    } catch {
      if (!stopped) queue = [...events, ...queue].slice(-200);
    } finally {
      sending = false;
      abort = null;
    }
  };
  function observe(
    type: string,
    callback: (entry: PerformanceEntry) => void,
    extra: Record<string, unknown> = {},
  ) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) callback(entry);
      });
      observer.observe({ type, buffered: false, ...extra } as PerformanceObserverInit);
      observers.push(observer);
    } catch {
      /* Not all browsers support all timing APIs. */
    }
  }
  observe(
    "event",
    (entry) => {
      const e = entry as PerformanceEventTiming;
      // Exclude hover, mouse compatibility, and focus events that duplicate a gesture.
      if (!["click", "pointerdown", "pointerup", "keydown"].includes(e.name)) return;
      const kind = e.name.startsWith("key")
        ? "key"
        : e.name === "click"
          ? "click"
          : e.name.startsWith("pointer")
            ? "pointer"
            : "other";
      add({
        type: "event_timing",
        kind,
        duration: cap(e.duration),
        delay: cap(e.processingStart - e.startTime),
      });
    },
    { durationThreshold: 16 },
  );
  observe("longtask", (entry) => add({ type: "long_task", duration: cap(entry.duration) }));
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput)
      add({ type: "layout_shift", value: Math.round(shift.value * 10000) });
  });
  const navigation = performance.getEntriesByType("navigation")[0];
  if (navigation) add({ type: "navigation", kind: "document", duration: cap(navigation.duration) });
  observe("resource", (entry) => {
    const resource = entry as PerformanceResourceTiming;
    let url: URL;
    try {
      url = new URL(resource.name);
    } catch {
      return;
    }
    if (url.origin !== location.origin || url.pathname === "/api/diagnostics") return;
    const kind = url.pathname.startsWith("/api/")
      ? "api"
      : resource.initiatorType === "script"
        ? "script"
        : resource.initiatorType === "css" || resource.initiatorType === "link"
          ? "style"
          : resource.initiatorType === "img"
            ? "image"
            : "other";
    add({
      type: "resource",
      kind,
      duration: cap(resource.duration),
      delay: cap(resource.responseStart - resource.requestStart),
    });
  });
  const click = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target.closest("button, a") : null;
    const label = element?.getAttribute("aria-label") || "";
    const actions: Record<string, NonNullable<Metric["action"]>> = {
      "Ask the assistant": "assistant",
      Assistant: "assistant",
      Search: "search",
      "Search everything": "search",
      Filter: "filter",
      Schedule: "schedule",
      Settings: "settings",
      "Add item": "add",
      Send: "send",
    };
    const href = element?.getAttribute("href");
    const navigation: Record<string, NonNullable<Metric["action"]>> = {
      "/today": "today",
      "/calendar": "calendar",
      "/agenda": "agenda",
      "/schedule": "schedule",
      "/settings": "settings",
    };
    add({
      type: "interaction",
      kind: "click",
      action: actions[label] || navigation[href || ""] || "other",
    });
  };
  const error = () => add({ type: "error", kind: "error" });
  const rejection = () => add({ type: "error", kind: "rejection" });
  const hidden = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  window.addEventListener("click", click, { passive: true, capture: true });
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  document.addEventListener("visibilitychange", hidden);
  const timer = window.setInterval(() => void flush(), 30000);
  return () => {
    stopped = true;
    abort?.abort();
    queue = [];
    for (const observer of observers) observer.disconnect();
    clearInterval(timer);
    window.removeEventListener("click", click, true);
    window.removeEventListener("error", error);
    window.removeEventListener("unhandledrejection", rejection);
    document.removeEventListener("visibilitychange", hidden);
  };
}
