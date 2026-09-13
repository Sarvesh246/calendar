"use client";
import { useEffect } from "react";
import { useMobileUndo } from "@/lib/mobile-item-actions";
export function MobileActionUndo() {
  const action = useMobileUndo(s => s.action);
  const set = useMobileUndo(s => s.set);
  useEffect(() => { if (!action) return; const timer = setTimeout(() => set(null), 10000); return () => clearTimeout(timer); }, [action, set]);
  if (!action) return null;
  return <div role="status" className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 shadow-lg"><span className="text-[13px]">{action.label}</span><button className="min-h-11 px-2 font-medium text-accent" onClick={() => { action.undo(); set(null); }}>Undo</button></div>;
}
