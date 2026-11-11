"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ToggleSwitch } from "@/components/toggle-switch";
import {
  diagnosticsEnabled,
  diagnosticsDeviceId,
  setDiagnosticsEnabled,
  subscribeDiagnostics,
} from "@/lib/diagnostics";

export function DiagnosticsSettings() {
  const enabled = useSyncExternalStore(subscribeDiagnostics, diagnosticsEnabled, () => false);
  const device = useSyncExternalStore(subscribeDiagnostics, diagnosticsDeviceId, () => null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[13.5px] font-medium text-ink">Performance diagnostics</span>
        <ToggleSwitch
          checked={enabled}
          onChange={setDiagnosticsEnabled}
          label="Performance diagnostics"
        />
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-soft">
        Sends interaction and performance timings and error counts to help improve Datebook. No
        typed text, calendar details or chat content is included. Removed after about 30 days. This
        setting applies to this device.{" "}
        <Link href="/privacy" className="text-accent underline">
          Privacy details
        </Link>
      </p>
      {enabled && device && (
        <p className="break-all text-[11px] text-ink-faint">Diagnostic device ID: {device}</p>
      )}
    </div>
  );
}
