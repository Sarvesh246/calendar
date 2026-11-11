"use client";
import { useEffect, useSyncExternalStore } from "react";
import { diagnosticsEnabled, startDiagnostics, subscribeDiagnostics } from "@/lib/diagnostics";
export function Diagnostics() {
  const enabled = useSyncExternalStore(subscribeDiagnostics, diagnosticsEnabled, () => false);
  useEffect(() => (enabled ? startDiagnostics() : undefined), [enabled]);
  return null;
}
