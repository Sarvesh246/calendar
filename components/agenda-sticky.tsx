"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { agendaStickyFace, type AgendaStickySection } from "@/lib/agenda-sticky";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SLIDE = {
  enter: (dir: number) => ({ y: dir * 14, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (dir: number) => ({ y: dir * -14, opacity: 0 }),
};

/**
 * Short on purpose. A fling through a busy semester can change the day every
 * few frames; a spring or a wait-mode crossfade would pile up and feel like
 * the header is chasing the scroll. A 200ms tween is long enough to read as
 * a roll and short enough to drop the last frame when the next day arrives.
 */
const SLIDE_TWEEN = { duration: 0.2, ease: motionTokens.ease };

export function AgendaSticky({
  sections,
  now,
  layout,
}: {
  sections: AgendaStickySection[];
  now: Date;
  /** Cards vs rows remount the section nodes; the observer has to start over. */
  layout: "cards" | "rows";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const [stickyId, setStickyId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [dir, setDir] = useState(1);

  useLayoutEffect(() => {
    if (sections.length === 0) return;
    const nodes = sections
      .map((s) => document.getElementById(`agenda-${s.id}`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (nodes.length === 0) return;

    const update = () => {
      const wrap = wrapRef.current;
      const measure = measureRef.current;
      if (wrap) {
        const parent = wrap.parentElement;
        if (parent) {
          const nextPinned = parent.getBoundingClientRect().top < wrap.getBoundingClientRect().top - 1;
          setPinned((previous) => (previous === nextPinned ? previous : nextPinned));
        }
      }

      // The lockup's own bottom edge is the hand-off line. Reading it beats
      // parsing `--mobile-header-height`, which is a `calc()` with an `env()`
      // in it — getComputedStyle hands back the token, not a length.
      const line = measure ? measure.getBoundingClientRect().bottom : 64;
      let current = sections[0].id;
      for (const el of nodes) {
        if (el.getBoundingClientRect().top <= line) {
          current = el.id.replace(/^agenda-/, "");
        } else {
          break;
        }
      }
      if (idRef.current === current) return;
      const prevIdx = sections.findIndex((s) => s.id === idRef.current);
      const nextIdx = sections.findIndex((s) => s.id === current);
      if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) {
        setDir(nextIdx > prevIdx ? 1 : -1);
      }
      idRef.current = current;
      setStickyId(current);
    };

    // One shared rAF gate. The first pass has to clear the handle too —
    // scheduling `update` directly left `raf` holding a stale but truthy id,
    // so every later scroll saw "already queued" and the label froze on
    // whichever section happened to be first.
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections, layout]);

  const sticky = sections.find((s) => s.id === stickyId) ?? sections[0];
  if (!sticky) return null;
  const face = agendaStickyFace(sticky, now);
  const warn = sticky.tone === "warn";

  return (
    <div
      ref={wrapRef}
      className="sticky top-[var(--mobile-header-height)] z-10 -mx-4 h-0 w-[calc(100%+2rem)] overflow-visible md:top-4"
    >
      <motion.div
        aria-hidden
        animate={{ opacity: pinned ? 1 : 0, y: pinned ? 0 : -8 }}
        transition={motionTokens.tweenStandard}
        className="pointer-events-none relative isolate w-full select-none"
      >
        <div className="agenda-sticky-veil absolute inset-0" />
        <div
          className="agenda-sticky-veil agenda-sticky-veil-warn absolute inset-0"
          data-active={warn ? "" : undefined}
        />
        <div className="relative px-4 pb-8 pt-2.5">
          <div ref={measureRef} className="relative h-9 overflow-hidden">
            <AnimatePresence initial={false} custom={dir}>
              <motion.div
                key={sticky.id}
                custom={dir}
                variants={SLIDE}
                initial="enter"
                animate="center"
                exit="exit"
                transition={SLIDE_TWEEN}
                className="absolute inset-0 flex items-center gap-3"
              >
                <Folio face={face} warn={warn} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Folio({
  face,
  warn,
}: {
  face: ReturnType<typeof agendaStickyFace>;
  warn: boolean;
}) {
  return (
    <>
      {face.numeral && (
        <span
          className={cn(
            "shrink-0 text-center text-[1.65rem] font-semibold leading-none tracking-[-0.04em] tabular-nums",
            face.numeral.length > 2 ? "min-w-[2ch] px-0.5" : "w-[2ch]",
            warn ? "text-warn" : "text-ink"
          )}
        >
          {face.numeral}
        </span>
      )}
      <span
        className={cn(
          "h-7 w-px shrink-0 rounded-full",
          warn ? "bg-warn/55" : "bg-ink/14"
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span
          className={cn(
            "truncate text-[12.5px] font-medium leading-none tracking-[-0.01em]",
            warn ? "text-warn" : "text-ink"
          )}
        >
          {face.kicker}
        </span>
        {face.subtitle && (
          <span className="truncate text-[11.5px] font-medium leading-none tracking-[0.01em] text-ink-faint">
            {face.subtitle}
          </span>
        )}
      </span>
    </>
  );
}
