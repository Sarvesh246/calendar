"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** A colour dot, for classes. */
  color?: string;
  hint?: string;
}

/**
 * A popover menu in place of the browser's own <select> list, which draws a
 * flat OS-blue box that ignores the theme. Opens above or below depending on
 * the room, scrolls inside itself, closes on Escape / outside press, and every
 * row is a 44px target. Keyboard: arrows move, Enter picks, Escape closes.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  label,
  className,
  buttonClassName,
  leading,
  align = "left",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name. */
  label: string;
  className?: string;
  buttonClassName?: string;
  leading?: ReactNode;
  align?: "left" | "right" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  function show() {
    setUp(false);
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  }

  // Opens downwards; if that runs off the screen and there is more room above,
  // flip. Measured after layout, so a sheet that is still rising cannot fool it.
  useLayoutEffect(() => {
    if (!open || up) return;
    const list = listRef.current?.getBoundingClientRect();
    const trigger = root.current?.getBoundingClientRect();
    if (!list || !trigger) return;
    if (list.bottom > window.innerHeight - 8 && trigger.top > window.innerHeight - trigger.bottom) {
      setUp(true);
    }
  }, [open, up]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function pick(i: number) {
    const option = options[i];
    if (option) onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    }
  }

  return (
    <div ref={root} className={cn("relative min-w-0", className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 text-left outline-none",
          buttonClassName,
        )}
      >
        {leading}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? "Choose"}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={label}
          className={cn(
            "select-menu-pop absolute z-[60] max-h-64 min-w-[12rem] max-w-[min(20rem,80vw)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_44px_-14px_rgb(0_0_0_/_0.45)]",
            up ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top",
            align === "right"
              ? "right-0"
              : align === "center"
                ? "left-1/2 -translate-x-1/2"
                : "left-0",
          )}
        >
          {options.map((option, i) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[14px] text-ink",
                  i === active && "bg-surface-sunken",
                  selected && "font-semibold",
                )}
              >
                {option.color && (
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint && (
                    <span className="block truncate text-[12px] font-normal text-ink-faint">
                      {option.hint}
                    </span>
                  )}
                </span>
                {selected && (
                  <Check aria-hidden className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.4} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
