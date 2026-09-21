"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Calendar,
  Copy,
  ExternalLink,
  LayoutGrid,
  MapPin,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  Square,
} from "lucide-react";
import { isNativeWrapper, postToNative, useNativeMessage } from "@/lib/native-bridge";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useDatebookStore } from "@/lib/store";
import { haptic } from "@/lib/haptic";

type LiveStatus = {
  success: boolean;
  code: string;
  message: string;
  activityId?: string;
  activityState?: string;
  activeCount?: number;
  activityIds?: string[];
  activityStates?: string[];
  supported?: boolean;
  activitiesEnabled?: boolean;
  extensionPresent?: boolean;
  scheduleEligible?: boolean;
  eligibilityReason?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  errorType?: string;
  operation?: string;
};

const statusCopy: Record<string, string> = {
  started: "Active",
  updated: "Active",
  alreadyRunning: "Active",
  ready: "Ready",
  ended: "No activity currently needed",
  notEligible: "No activity currently needed",
  activitiesDisabled: "Disabled in iOS Settings",
  unsupported: "Unsupported on this device",
  extensionMissing: "Widget extension missing",
  requestFailed: "Failed to start",
  updateFailed: "Failed to update",
  endFailed: "Failed to stop",
};

/** IPA-only settings and diagnostics for native features. Hidden on the web. */
export function NativeIosSection() {
  const wrapped = isNativeWrapper();
  const sync = useDatebookStore((s) => s.settings.appleCalendarSync);
  const liveEnabled = useDatebookStore((s) => s.settings.liveActivityEnabled !== false);
  const privacy = useDatebookStore((s) => s.settings.liveActivityPrivacy ?? "show");
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = () => {
    setBusy("refresh");
    postToNative("getLiveActivityStatus");
  };

  useEffect(() => {
    if (!wrapped) return;
    postToNative("getNativeCapabilities");
    postToNative("getLiveActivityStatus");
  }, [wrapped]);

  useNativeMessage("nativeCapabilities", (payload) => {
    const cap = payload as { calendar?: string } | null;
    if (cap?.calendar) setCalendarStatus(cap.calendar);
  });

  useNativeMessage("liveActivityStatus", (payload) => {
    if (payload && typeof payload === "object") setLiveStatus(payload as LiveStatus);
    setBusy(null);
  });

  if (!wrapped) return null;

  const label = liveStatus
    ? statusCopy[liveStatus.code] ??
      (liveStatus.activeCount ? "Active" : liveStatus.activitiesEnabled ? "Ready" : "Unavailable")
    : "Checking…";
  const tone =
    label === "Active" || label === "Ready"
      ? "text-accent"
      : label.startsWith("Failed") || label.includes("missing")
        ? "text-warn"
        : "text-ink-soft";

  return (
    <div className="mt-3 flex flex-col gap-3">
      <section className="overflow-hidden rounded-xl border border-line/80 bg-surface-sunken/25">
        <div className="flex items-center justify-between gap-4 px-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" aria-hidden />
              <p className="text-[14px] font-medium text-ink">Live Activity</p>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
              Keep your current schedule or focus session available on the Lock Screen.
            </p>
          </div>
          <ToggleSwitch
            checked={liveEnabled}
            onChange={(liveActivityEnabled) => {
              haptic("light");
              updateSettings({ liveActivityEnabled });
            }}
            label="Show Datebook on Lock Screen"
          />
        </div>

        <div className="border-t border-line/70 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-ink-soft">Status</p>
              <p className={`mt-0.5 text-[13px] font-semibold ${tone}`}>{label}</p>
            </div>
            {liveStatus?.activitiesEnabled === false && (
              <button
                type="button"
                onClick={() => postToNative("openNativeSettings")}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink"
              >
                Open Settings <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            {liveStatus?.message ?? "Reading ActivityKit status from this iPhone…"}
          </p>
        </div>

        <div className="border-t border-line/70 px-3 py-3">
          <p className="text-[12px] font-medium text-ink-soft">Lock Screen details</p>
          <div className="mt-2 grid grid-cols-2 rounded-lg bg-surface-sunken p-1" role="radiogroup" aria-label="Lock Screen details">
            {(["show", "hide"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={privacy === value}
                onClick={() => {
                  haptic("selection");
                  updateSettings({ liveActivityPrivacy: value });
                }}
                className={`min-h-9 rounded-md px-2 text-[12px] font-medium transition-colors ${
                  privacy === value ? "bg-surface text-ink shadow-sm" : "text-ink-faint"
                }`}
              >
                {value === "show" ? "Show event names" : "Hide private details"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-line/70 p-3 sm:grid-cols-3">
          <DiagnosticButton
            icon={Play}
            label="Start Test Live Activity"
            busy={busy === "test"}
            onClick={() => {
              setBusy("test");
              postToNative("startTestLiveActivity");
            }}
          />
          <DiagnosticButton
            icon={Square}
            label="Stop Live Activity"
            busy={busy === "stop"}
            onClick={() => {
              setBusy("stop");
              postToNative("stopAllLiveActivities");
            }}
          />
          <DiagnosticButton icon={RefreshCw} label="Refresh Status" busy={busy === "refresh"} onClick={refresh} />
        </div>

        <div className="border-t border-line/70 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            className="min-h-8 text-[12px] font-medium text-ink-soft underline-offset-4 hover:underline"
          >
            {detailsOpen ? "Hide diagnostics" : "Show diagnostics"}
          </button>
          {detailsOpen && (
            <div className="mt-2 rounded-lg bg-surface-sunken px-2.5 py-2">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-faint">
                {JSON.stringify(liveStatus, null, 2)}
              </pre>
              <button
                type="button"
                className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[11px] font-medium text-ink"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(JSON.stringify(liveStatus, null, 2))
                    .then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    })
                    .catch((error) => console.error("Could not copy Live Activity diagnostics", error));
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden /> {copied ? "Copied" : "Copy debug report"}
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-sunken/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[14px] text-ink">Apple Calendar</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
            Keep a Datebook calendar in Calendar.app. Edits still live here.
          </p>
        </div>
        <ToggleSwitch
          checked={Boolean(sync)}
          onChange={(appleCalendarSync) => {
            haptic("light");
            updateSettings({ appleCalendarSync });
          }}
          label="Apple Calendar"
        />
      </div>
      {calendarStatus && <p className="px-1 text-[12px] text-ink-faint">{calendarStatus}</p>}
      <ul className="grid gap-2 text-[12.5px] leading-relaxed text-ink-soft">
        <Li icon={LayoutGrid} text="Today, Up Next, assignments, and classes widgets — add them from the Home Screen." />
        <Li icon={Sparkles} text="Siri and Shortcuts: “Add to Datebook”, Start Focus, Open Today." />
        <Li icon={Share2} text="Share a syllabus, ICS, link, or screenshot into Datebook from any app." />
        <Li icon={MapPin} text="On an item, add When I arrive so the reminder fires at that place." />
        <Li icon={Calendar} text="Search assignments and classes from Spotlight." />
      </ul>
    </div>
  );
}

function DiagnosticButton({
  icon: Icon,
  label,
  busy,
  onClick,
}: {
  icon: typeof Play;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink disabled:opacity-60"
    >
      <Icon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
      {label}
    </button>
  );
}

function Li({ icon: Icon, text }: { icon: typeof Calendar; text: string }) {
  return (
    <li className="flex gap-2 rounded-lg border border-line/70 bg-surface-sunken/25 px-2.5 py-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} aria-hidden />
      <span>{text}</span>
    </li>
  );
}
