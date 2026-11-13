"use client";

import { classLabel } from "@/lib/course-label";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDatebookStore } from "@/lib/store";
import { CategorySyllabusControl } from "@/components/import-syllabus";
import { cn } from "@/lib/utils";
import { CategoryClassTimesControl } from "@/components/category-class-times";
import { haptic } from "@/lib/haptic";
import type { Category } from "@/lib/types";

export function CategoryEditor({
  category: cat,
  categories,
  confirmDeleteId,
  onConfirmDeleteId,
}: {
  category: Category;
  categories: Category[];
  confirmDeleteId: string | null;
  onConfirmDeleteId: (id: string | null) => void;
}) {
  const updateCategory = useDatebookStore((s) => s.updateCategory);
  const [name, setName] = useState(cat.name);
  const [classTitle, setClassTitle] = useState(cat.classTitle ?? "");
  const nameFocus = useRef(false);
  const titleFocus = useRef(false);
  const nameRef = useRef(name);
  const titleRef = useRef(classTitle);
  const catRef = useRef(cat);
  // Mirrored after commit for the unmount flush below, which needs the latest
  // values without re-subscribing.
  useLayoutEffect(() => {
    nameRef.current = name;
    titleRef.current = classTitle;
    catRef.current = cat;
  });

  useEffect(() => {
    if (!nameFocus.current) setName(cat.name);
  }, [cat.name]);
  useEffect(() => {
    if (!titleFocus.current) setClassTitle(cat.classTitle ?? "");
  }, [cat.classTitle]);

  function commitName(raw = nameRef.current) {
    const current = catRef.current;
    const next = raw.trim() || "Uncategorized";
    setName(next);
    if (next !== current.name) updateCategory(current.id, { name: next });
  }

  function commitClassTitle(raw = titleRef.current) {
    const current = catRef.current;
    const next = raw.trim();
    setClassTitle(next);
    if (next !== (current.classTitle ?? "")) {
      updateCategory(current.id, { classTitle: next || undefined });
    }
  }

  function saveClassFields() {
    commitName();
    commitClassTitle();
  }

  useEffect(
    () => () => {
      commitName();
      commitClassTitle();
    },
    // Persist the last draft if the row unmounts without a blur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const classDirty =
    (name.trim() || "Uncategorized") !== cat.name || classTitle.trim() !== (cat.classTitle ?? "");

  return (
    <div className="flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl border border-line/80 bg-surface-sunken/40 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <input
          type="color"
          value={cat.color}
          onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
          className="h-7 w-7 shrink-0 cursor-pointer rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
          aria-label={`${cat.name} color`}
        />
        <input
          type="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={name}
          onFocus={() => {
            nameFocus.current = true;
          }}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            nameFocus.current = false;
            commitName();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }}
          aria-label={`${cat.name} name`}
          className="field-inline min-h-11 min-w-0 flex-1 overflow-hidden bg-transparent text-[14px] text-ink focus:outline-none md:px-2"
        />
        <button
          type="button"
          onClick={() => {
            saveClassFields();
            haptic("success");
          }}
          disabled={!classDirty}
          className="shrink-0 text-[12px] font-medium text-accent disabled:text-ink-faint disabled:opacity-40"
        >
          Save
        </button>
        {cat.archived && <span className="shrink-0 text-[11px] text-ink-faint">Archived</span>}
        {/* From `sm` up there is room beside the name. On a phone these two sat
            in the same row and cut the name to "ENGR-102:204,21", with Delete a
            12px word one slip away from Archive — so there they get their own
            footer row with real touch targets (below). */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex sm:gap-3">
          <button
            type="button"
            onClick={() => updateCategory(cat.id, { archived: !cat.archived })}
            className="text-[12px] font-medium text-ink-faint hover:text-ink"
          >
            {cat.archived ? "Restore" : "Archive"}
          </button>
          {categories.length > 1 && (
            <button
              type="button"
              onClick={() => onConfirmDeleteId(confirmDeleteId === cat.id ? null : cat.id)}
              aria-expanded={confirmDeleteId === cat.id}
              className="text-[12px] font-medium text-warn"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <label className="flex min-w-0 items-center gap-2 pl-10 text-[12px] text-ink-faint">
        <span className="shrink-0">Meeting name</span>
        <input
          type="text"
          enterKeyHint="done"
          autoComplete="off"
          value={classTitle}
          onFocus={() => {
            titleFocus.current = true;
          }}
          onChange={(e) => setClassTitle(e.target.value)}
          onBlur={() => {
            titleFocus.current = false;
            commitClassTitle();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }}
          placeholder={name.trim() || cat.name}
          aria-label={`${cat.name} meeting name`}
          className="field-inline min-h-11 min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none md:px-2"
        />
      </label>
      {!cat.archived && (
        <div className="mt-1.5 border-t border-line/60 pt-2 pl-10">
          <CategoryClassTimesControl category={cat} />
          <div className="mt-1">
            <CategorySyllabusControl category={cat} />
          </div>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between border-t border-line/60 pt-1 sm:hidden">
        <button
          type="button"
          onClick={() => updateCategory(cat.id, { archived: !cat.archived })}
          className="press-none -ml-1 flex min-h-11 items-center rounded-lg px-2 text-[13px] font-medium text-ink-soft active:bg-surface-sunken"
        >
          {cat.archived ? "Restore class" : "Archive class"}
        </button>
        {categories.length > 1 && (
          <button
            type="button"
            onClick={() => onConfirmDeleteId(confirmDeleteId === cat.id ? null : cat.id)}
            aria-expanded={confirmDeleteId === cat.id}
            className="press-none -mr-1 flex min-h-11 items-center rounded-lg px-2 text-[13px] font-medium text-warn active:bg-warn-soft"
          >
            Delete…
          </button>
        )}
      </div>
      {confirmDeleteId === cat.id && (
        <CategoryDeleteConfirm
          category={cat}
          categories={categories}
          onConfirm={() => onConfirmDeleteId(null)}
          onCancel={() => onConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}

export function CategoryDeleteConfirm({
  category,
  categories,
  onConfirm,
  onCancel,
}: {
  category: Category;
  categories: Category[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const items = useDatebookStore((s) => s.items);
  const sources = useDatebookStore((s) => s.importSources);
  const deleteCategory = useDatebookStore((s) => s.deleteCategory);
  const updateCategory = useDatebookStore((s) => s.updateCategory);
  const [choice, setChoice] = useState<"delete-items" | "archive" | "move-items" | null>(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState("");
  const count = items.filter((i) => i.categoryId === category.id).length;
  const destinations = categories.filter((c) => c.id !== category.id && !c.archived);
  const validTarget = destinations.some((c) => c.id === targetId);
  const feedIds = new Set(sources.filter((s) => /^https?:\/\//i.test(s.url)).map((s) => s.id));
  const hasFeedItems = items.some(
    (i) => i.categoryId === category.id && i.sourceId && feedIds.has(i.sourceId),
  );
  const itemLabel = `${count} item${count === 1 ? "" : "s"}`;

  function confirm() {
    if (!choice || (choice === "move-items" && !validTarget)) return;
    if (choice === "archive") {
      updateCategory(category.id, { archived: true });
      haptic("success");
    } else {
      const removed = deleteCategory(
        category.id,
        choice === "delete-items"
          ? { kind: "delete-items" }
          : { kind: "move-items", targetCategoryId: targetId },
      );
      if (!removed) {
        setError("The class or destination changed. Choose an available class and try again.");
        return;
      }
      haptic("warn");
    }
    onConfirm();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-line/60 pt-3">
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">
          What should happen to {classLabel(category)}?
        </legend>
        <p className="mb-1 text-[12px] leading-snug text-ink-soft">
          {itemLabel} {count === 1 ? "belongs" : "belong"} to this class, including past and
          completed items.
        </p>
        {(
          [
            [
              "delete-items",
              "Delete class and its items",
              `Permanently remove this class and all ${itemLabel}.`,
            ],
            [
              "archive",
              "Archive class",
              "Keep the class and its items, hidden from active views. You can restore it later.",
            ],
            [
              "move-items",
              "Move items to another class",
              "Keep the items in a class you choose, then delete this class.",
            ],
          ] as const
        ).map(([value, label, description]) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-line/70 px-3 py-2.5 has-checked:border-accent/60 has-checked:bg-accent/5"
          >
            <input
              type="radio"
              name={`remove-class-${category.id}`}
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
                setError("");
              }}
              className="mt-0.5 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{label}</span>
              <span className="block text-[12px] leading-snug text-ink-soft">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {choice === "move-items" && (
        <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-soft">
          Destination class
          <select
            aria-label="Destination class"
            value={validTarget ? targetId : ""}
            onChange={(e) => {
              setTargetId(e.target.value);
              setError("");
            }}
            className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink"
          >
            <option value="">Choose a class</option>
            {destinations.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)}
              </option>
            ))}
          </select>
          {destinations.length === 0 && (
            <span className="font-normal">Restore or add another class before moving items.</span>
          )}
        </label>
      )}
      {choice === "delete-items" && hasFeedItems && (
        <p className="text-[12px] leading-snug text-ink-soft">
          A connected calendar feed can import these items again. Archive the class to keep them
          hidden.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-warn">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={!choice || (choice === "move-items" && !validTarget)}
          className={cn(
            "min-h-11 rounded-lg px-3 text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40",
            choice === "archive" ? "bg-accent" : "bg-warn",
          )}
        >
          {choice === "archive"
            ? "Archive class"
            : choice === "move-items"
              ? "Move items and delete class"
              : choice === "delete-items"
                ? `Delete class and ${itemLabel}`
                : "Choose an action"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg px-3 text-[12.5px] font-medium text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
