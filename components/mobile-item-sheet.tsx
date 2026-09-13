"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { format } from "date-fns";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { changeMobileStatus, mobileReschedule, relativeScheduleDate } from "@/lib/mobile-item-actions";
import type { Item } from "@/lib/types";

export function MobileItemSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  useLockBodyScroll(true);
  return createPortal(<div className="fixed inset-0 z-[70]" onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
    <div className="overlay-scrim absolute inset-0" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="mobile-action-sheet absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line bg-surface p-4 pb-[max(1rem,var(--safe-bottom))]">
      <header className="flex shrink-0 items-center justify-between gap-3"><h2 className="min-w-0 truncate text-[16px] font-semibold">{title}</h2><button aria-label="Close item sheet" className="flex h-11 w-11 shrink-0 items-center justify-center" onClick={onClose}><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 overflow-y-auto overscroll-contain">{title === "Edit item" && <p className="text-[12px] text-ink-soft">Changes save as you edit.</p>}{children}</div>
    </div>
  </div>, document.body);
}
const control = "min-h-11 rounded-lg border border-line bg-surface-sunken px-3 text-[13px]";
export function MobileTaskActions({ item, onClose, onEdit, initialReschedule = false }: { item: Item; onClose: () => void; onEdit: () => void; initialReschedule?: boolean }) {
  const [reschedule, setReschedule] = useState(initialReschedule);
  const [plan, setPlan] = useState(item.type === "assignment" || Boolean(item.sourceId));
  const [date, setDate] = useState(relativeScheduleDate(1));
  const apply = (next: string) => { mobileReschedule(item, next, plan); onClose(); };
  return <MobileItemSheet title={item.title} onClose={onClose}>
    <p className="mb-3 text-[12px] text-ink-soft">Deadline: {format(new Date(item.at), "EEE, MMM d · p")}</p>
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunken p-1" aria-label="Task status">
      {([['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']] as const).map(([value, label]) => <button key={value} aria-pressed={(item.status ?? "todo") === value} className={`${control} ${(item.status ?? "todo") === value ? "bg-accent text-accent-ink" : ""}`} onClick={() => { changeMobileStatus(item, value); onClose(); }}>{label}</button>)}
    </div>
    <p className="mt-2 text-[11px] text-ink-faint">Swipe right to start or complete; left to reschedule. Tap the circle for quick completion.</p>
    <div className="my-3 flex gap-2"><button className={`${control} flex-1`} aria-expanded={reschedule} onClick={() => setReschedule(!reschedule)}>Reschedule</button><button className={`${control} flex-1`} onClick={onEdit}>Edit item</button></div>
    {reschedule && <div className="space-y-3 border-t border-line pt-3">
      <label className="flex flex-col gap-1 text-[12px]">Reschedule options<select aria-label="Reschedule mode" className={control} value={plan ? "plan" : "deadline"} onChange={e => setPlan(e.target.value === "plan")}><option value="plan">Plan when to work</option><option value="deadline">Change actual deadline</option></select></label>
      <p className="text-[12px] text-ink-soft">{plan ? "Creates a separate work task. The original deadline stays unchanged." : "Changes the actual due date for this item."}{item.sourceId && !plan && " This is a local override of the imported deadline."}</p>
      <div className="grid grid-cols-2 gap-2"><button className={control} onClick={() => apply(relativeScheduleDate(1))}>Tomorrow</button><button className={control} onClick={() => apply(relativeScheduleDate(7))}>Next week</button></div>
      <label className="flex flex-col gap-1 text-[12px]">Choose date<input aria-label="Reschedule date" type="date" className={`${control} min-w-0 text-[16px]`} value={date} onChange={e => setDate(e.target.value)} /></label>
      <button className={`${control} w-full bg-accent text-accent-ink`} disabled={!date} onClick={() => apply(date)}>{plan ? "Plan work" : "Change deadline"}</button>
    </div>}
  </MobileItemSheet>;
}
