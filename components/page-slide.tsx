"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  endTabDrag,
  getTabDragSnap,
  resetTabTransition,
  subscribeTabDrag,
  tabIndexForPath,
  tabPageX,
  tabTransition,
} from "@/lib/tab-swipe";
import { cn } from "@/lib/utils";

const pageSpring = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.7 };

/**
 * Main-tab pages follow the bottom-nav swipe and then complete with the same
 * spring, so the destination never cuts in while a finger is still down.
 */
export function PageSlide({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const drag = useSyncExternalStore(subscribeTabDrag, getTabDragSnap, getTabDragSnap);
  const onCalendar = pathname === "/calendar";
  const isTab = tabIndexForPath(pathname) >= 0;
  const enterX = isTab ? tabTransition.enterX : 0;
  const followFinger = drag.dragging && pathname === drag.origin;

  useEffect(() => {
    endTabDrag();
    const clear = window.setTimeout(() => {
      tabPageX.set(0);
      resetTabTransition();
    }, 450);
    return () => window.clearTimeout(clear);
  }, [pathname]);

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip",
        onCalendar && "md:overflow-hidden"
      )}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={pathname}
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-1 flex-col",
            onCalendar && "md:min-h-0 md:overflow-hidden"
          )}
          initial={isTab ? { x: enterX, opacity: tabTransition.fromSwipe ? 1 : 0.92 } : false}
          animate={followFinger ? undefined : { x: 0, opacity: 1 }}
          exit={
            isTab
              ? {
                  x: tabTransition.exitX,
                  opacity: tabTransition.fromSwipe ? 1 : 0.92,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                }
              : undefined
          }
          transition={pageSpring}
          style={followFinger ? { x: tabPageX } : undefined}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
