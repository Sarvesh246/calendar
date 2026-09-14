"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Sparkles, X } from "lucide-react";
import { format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useItemCardChrome } from "@/lib/card-chrome";
import { searchItems } from "@/lib/search";
import { dayKey, itemOccupiesDay } from "@/lib/date-utils";
import { looksLikeRichCreate, shouldAskAssistant } from "@/lib/ai-assistant";
import { MobileItemSheet } from "@/components/mobile-item-sheet";
import { ItemCard } from "@/components/item-card";
import { Reveal } from "@/components/ui/reveal";
import { motion as motionTokens } from "@/lib/motion";

const recentKey = "datebook-recent-searches";
const field = "focus-within-ring min-h-11 min-w-0 rounded-lg border border-line bg-surface-sunken px-2 text-[13px] focus-within:border-accent";
export function MobileSearch({ onClose }: { onClose: () => void }) {
  const items = useDatebookStore(s => s.items);
  const categories = useDatebookStore(s => s.categories);
  const askAI = useUIStore(s => s.askAI);
  const chrome = useItemCardChrome();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => { try { const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]"); return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string").slice(0, 5) : []; } catch { return []; } });
  // Search can touch every item and notes field. Deferring the inputs lets the
  // key/select paint first, then updates one memoized result set instead of
  // sorting the whole calendar again on unrelated focus/animation renders.
  const deferredQuery = useDeferredValue(query);
  const deferredCategory = useDeferredValue(category);
  const deferredStatus = useDeferredValue(status);
  const deferredDate = useDeferredValue(date);
  const matches = useMemo(() => {
    const candidates = deferredQuery.trim()
      ? searchItems(items, categories, deferredQuery)
      : [...items].sort((a, b) => a.at.localeCompare(b.at));
    const pickedDate = deferredDate ? new Date(`${deferredDate}T12:00:00`) : null;
    return candidates.filter(i =>
      (!deferredCategory || i.categoryId === deferredCategory) &&
      (!deferredStatus || (i.type !== "event" && (i.status ?? "todo") === deferredStatus)) &&
      (!pickedDate || itemOccupiesDay(i, pickedDate))
    );
  }, [categories, deferredCategory, deferredDate, deferredQuery, deferredStatus, items]);
  const categoriesById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const current = useMemo(() => items.find(i => i.id === selected), [items, selected]);
  function remember(value: string) { const trimmed = value.trim(); if (!trimmed) return; const next = [trimmed, ...recent.filter(s => s !== trimmed)].slice(0, 5); setRecent(next); try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* Search still works without storage. */ } }
  return <MobileItemSheet title="Search items" onClose={onClose}>
    {/* The accent ring is the wrapper's own border, not an outline on the
        input. An outline is painted *outside* the element, so inside a
        scrolling sheet it was being shaved off along the top and sides — a
        highlight that only half-traces the box it belongs to. A border can't
        be clipped, and it animates. */}
    <div data-field-group="" className={`focus-within-ring flex items-center rounded-lg border bg-surface-sunken px-2 transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] ${focused ? "border-accent" : "border-line"}`}>
      <Search className={`mr-2 h-4 w-4 shrink-0 transition-colors duration-[var(--motion-standard)] ${focused ? "text-accent" : "text-ink-faint"}`} strokeWidth={1.9} aria-hidden />
      <input aria-label="Search items" autoFocus className="min-h-11 w-full min-w-0 bg-transparent text-[16px] outline-none" placeholder="Title, notes, location…" value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={e => { if (e.key === "Enter") remember(query); }} />
      <AnimatePresence initial={false}>{query && <motion.button key="clear-query" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8, transition: { duration: motionTokens.exit } }} transition={motionTokens.springSnappy} aria-label="Clear search" className="press-none -mr-1 flex h-11 w-9 shrink-0 items-center justify-center text-ink-faint" onClick={() => setQuery("")}><X className="h-4 w-4" /></motion.button>}</AnimatePresence>
    </div>
    <div className="my-3 grid grid-cols-2 gap-2">
      <select aria-label="Search class" className={field} value={category} onChange={e => setCategory(e.target.value)}><option value="">All classes</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="Search status" className={field} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select>
      <label className="col-span-2 flex items-center gap-2 text-[12px]">Date<input aria-label="Search date" className={`${field} flex-1 text-[16px]`} type="date" value={date} onChange={e => setDate(e.target.value)} /><AnimatePresence initial={false}>{(date || category || status) && <motion.button key="clear" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: motionTokens.exit } }} transition={motionTokens.springSnappy} className="min-h-11 shrink-0 px-2 text-accent" onClick={() => { setDate(""); setCategory(""); setStatus(""); }}>Clear filters</motion.button>}</AnimatePresence></label>
    </div>
    <Reveal open={!query && recent.length > 0}><div className="mb-3"><div className="flex items-center justify-between text-[12px] text-ink-soft">Recent searches<button className="min-h-11 px-2" onClick={() => { setRecent([]); try { localStorage.removeItem(recentKey); } catch {} }}>Clear recent</button></div><div className="flex flex-wrap gap-2">{recent.map(s => <button key={s} className={field} onClick={() => setQuery(s)}>{s}</button>)}</div></div></Reveal>
    {query.trim().length > 2 && <button type="button" className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 text-left text-[13px] text-ink" onClick={() => { remember(query); askAI(query.trim()); onClose(); }}><Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} aria-hidden /><span className="min-w-0 truncate">{looksLikeRichCreate(query) ? `Add with assistant: “${query.trim()}”` : shouldAskAssistant(query) ? `Ask: “${query.trim()}”` : `Ask the assistant about “${query.trim()}”`}</span></button>}
    <p role="status" className="mb-2 text-[12px] text-ink-soft">{matches.length} matching item{matches.length === 1 ? "" : "s"}{matches.length > 100 ? " · showing first 100, refine your search" : ""}</p>
    <motion.div key={`${deferredQuery}|${deferredCategory}|${deferredStatus}|${deferredDate}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: motionTokens.standard, ease: motionTokens.ease }} className="divide-y divide-line">{matches.slice(0, 100).map(i => <button key={i.id} className="flex min-h-16 w-full flex-col justify-center gap-1 py-3 text-left" onClick={() => { remember(query); setSelected(i.id); }}><span className="text-[14px] font-medium">{i.title}</span><span className="text-[12px] text-ink-soft">{format(new Date(i.at), "EEE, MMM d, yyyy")}{!i.allDay && ` · ${format(new Date(i.at), "p")}`} · {categoriesById.get(i.categoryId ?? "")?.name ?? "No class"} · {i.type === "event" ? "Scheduled" : i.status === "done" ? "Done" : i.status === "doing" ? "In progress" : "To do"}</span></button>)}</motion.div>
    <AnimatePresence initial={false}>{matches.length === 0 && <motion.p key="empty" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: motionTokens.exit } }} transition={{ duration: motionTokens.standard, ease: motionTokens.ease }} className="py-6 text-center text-[13px] text-ink-soft">No matching items. Try another word or clear a filter.</motion.p>}</AnimatePresence>
    {current && <MobileItemSheet title={current.title} onClose={() => setSelected(null)}><p className="mb-3 text-[13px] text-ink-soft">{dayKey(new Date(current.at))} · {categoriesById.get(current.categoryId ?? "")?.name ?? "No class"}</p><ItemCard item={current} category={categoriesById.get(current.categoryId ?? "")} {...chrome} /></MobileItemSheet>}
  </MobileItemSheet>;
}
