"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useDatebookStore } from "@/lib/store";
import { useItemCardChrome } from "@/lib/card-chrome";
import { searchItems } from "@/lib/search";
import { dayKey, itemOccupiesDay } from "@/lib/date-utils";
import { MobileItemSheet } from "@/components/mobile-item-sheet";
import { ItemCard } from "@/components/item-card";

const recentKey = "datebook-recent-searches";
const field = "min-h-11 min-w-0 rounded-lg border border-line bg-surface-sunken px-2 text-[13px]";
export function MobileSearch({ onClose }: { onClose: () => void }) {
  const items = useDatebookStore(s => s.items);
  const categories = useDatebookStore(s => s.categories);
  const chrome = useItemCardChrome();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => { try { const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]"); return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string").slice(0, 5) : []; } catch { return []; } });
  const matches = (query.trim() ? searchItems(items, categories, query) : [...items].sort((a, b) => a.at.localeCompare(b.at))).filter(i =>
    (!category || i.categoryId === category) && (!status || (i.type !== "event" && (i.status ?? "todo") === status)) && (!date || itemOccupiesDay(i, new Date(`${date}T12:00:00`)))
  );
  const current = items.find(i => i.id === selected);
  function remember(value: string) { const trimmed = value.trim(); if (!trimmed) return; const next = [trimmed, ...recent.filter(s => s !== trimmed)].slice(0, 5); setRecent(next); try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* Search still works without storage. */ } }
  return <MobileItemSheet title="Search items" onClose={onClose}>
    <div data-field-group=""><input aria-label="Search items" autoFocus className={`${field} w-full text-[16px]`} placeholder="Title, notes, location…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") remember(query); }} /></div>
    <div className="my-3 grid grid-cols-2 gap-2">
      <select aria-label="Search class" className={field} value={category} onChange={e => setCategory(e.target.value)}><option value="">All classes</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="Search status" className={field} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select>
      <label className="col-span-2 flex items-center gap-2 text-[12px]">Date<input aria-label="Search date" className={`${field} flex-1 text-[16px]`} type="date" value={date} onChange={e => setDate(e.target.value)} />{(date || category || status) && <button className="min-h-11 px-2 text-accent" onClick={() => { setDate(""); setCategory(""); setStatus(""); }}>Clear filters</button>}</label>
    </div>
    {!query && recent.length > 0 && <div className="mb-3"><div className="flex items-center justify-between text-[12px] text-ink-soft">Recent searches<button className="min-h-11 px-2" onClick={() => { setRecent([]); try { localStorage.removeItem(recentKey); } catch {} }}>Clear recent</button></div><div className="flex flex-wrap gap-2">{recent.map(s => <button key={s} className={field} onClick={() => setQuery(s)}>{s}</button>)}</div></div>}
    <p role="status" className="mb-2 text-[12px] text-ink-soft">{matches.length} matching item{matches.length === 1 ? "" : "s"}{matches.length > 100 ? " · showing first 100, refine your search" : ""}</p>
    <div className="divide-y divide-line">{matches.slice(0, 100).map(i => <button key={i.id} className="flex min-h-16 w-full flex-col justify-center gap-1 py-3 text-left" onClick={() => { remember(query); setSelected(i.id); }}><span className="text-[14px] font-medium">{i.title}</span><span className="text-[12px] text-ink-soft">{format(new Date(i.at), "EEE, MMM d, yyyy")}{!i.allDay && ` · ${format(new Date(i.at), "p")}`} · {categories.find(c => c.id === i.categoryId)?.name ?? "No class"} · {i.type === "event" ? "Scheduled" : i.status === "done" ? "Done" : i.status === "doing" ? "In progress" : "To do"}</span></button>)}</div>
    {matches.length === 0 && <p className="py-6 text-center text-[13px] text-ink-soft">No matching items. Try another word or clear a filter.</p>}
    {current && <MobileItemSheet title={current.title} onClose={() => setSelected(null)}><p className="mb-3 text-[13px] text-ink-soft">{dayKey(new Date(current.at))} · {categories.find(c => c.id === current.categoryId)?.name ?? "No class"}</p><ItemCard item={current} category={categories.find(c => c.id === current.categoryId)} {...chrome} /></MobileItemSheet>}
  </MobileItemSheet>;
}
