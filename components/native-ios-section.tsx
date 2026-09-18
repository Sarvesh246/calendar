"use client";

import { useEffect, useState } from "react";
import { Calendar, LayoutGrid, MapPin, Share2, Sparkles, Timer } from "lucide-react";
import { isNativeWrapper, postToNative, useNativeMessage } from "@/lib/native-bridge";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useDatebookStore } from "@/lib/store";
import { haptic } from "@/lib/haptic";

/**
 * IPA-only: Apple Calendar sync plus a short map of the system features the
 * wrapper exposes (widgets, Siri, share, Live Activities). Hidden on the web.
 */
export function NativeIosSection() {
  const wrapped = isNativeWrapper();
  const sync = useDatebookStore((s) => s.settings.appleCalendarSync);
  const updateSettings = useDatebookStore((s) => s.updateSettings);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);

  useEffect(() => {
    if (wrapped) postToNative("getNativeCapabilities");
  }, [wrapped]);

  useNativeMessage("nativeCapabilities", (payload) => {
    const cap = payload as { calendar?: string } | null;
    if (cap?.calendar) setCalendarStatus(cap.calendar);
  });

  if (!wrapped) return null;

  return (
    <div className="mt-3 flex flex-col gap-3">
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
      {calendarStatus && (
        <p className="px-1 text-[12px] text-ink-faint">{calendarStatus}</p>
      )}
      <ul className="grid gap-2 text-[12.5px] leading-relaxed text-ink-soft">
        <Li icon={Timer} text="Class and Focus show in Dynamic Island and on the Lock Screen." />
        <Li icon={LayoutGrid} text="Today, Up Next, assignments, and classes widgets — add them from the Home Screen." />
        <Li icon={Sparkles} text="Siri and Shortcuts: “Add to Datebook”, Start Focus, Open Today." />
        <Li icon={Share2} text="Share a syllabus, ICS, link, or screenshot into Datebook from any app." />
        <Li icon={MapPin} text="On an item, add When I arrive so the reminder fires at that place." />
        <Li icon={Calendar} text="Search assignments and classes from Spotlight." />
      </ul>
    </div>
  );
}

function Li({ icon: Icon, text }: { icon: typeof Timer; text: string }) {
  return (
    <li className="flex gap-2 rounded-lg border border-line/70 bg-surface-sunken/25 px-2.5 py-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
      <span>{text}</span>
    </li>
  );
}
