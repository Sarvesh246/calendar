"use client";

import { useEffect, useReducer, type ComponentType } from "react";

/**
 * A code-split component that, once its chunk is in, renders synchronously.
 *
 * `next/dynamic` sits on `React.lazy`, which suspends on its first render even
 * when the module was fetched long ago — so expanding a card or opening the
 * palette always painted one frame of skeleton (or nothing) before the real
 * thing: the "flash" on open. Here the loaded component is kept in module
 * scope; if it's there, it renders in the same commit as the click.
 *
 * `preload()` starts (or joins) the fetch. `warmUp()` in `lib/warm-chunks.ts`
 * calls it for every panel while the main thread is idle, so by the time
 * anyone taps, nothing is left to wait for. Client-only, like `ssr: false`:
 * the server (and hydration) render the fallback.
 */
export type LazyComponent<P extends object> = ComponentType<P> & { preload: () => Promise<unknown> };

export function lazyComponent<P extends object>(
  load: () => Promise<ComponentType<P>>,
  Fallback?: ComponentType
): LazyComponent<P> {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const preload = () => {
    pending ??= load().then((C) => {
      Loaded = C;
      return C;
    });
    // A failed fetch (offline, deploy swapped chunks) may be retried later.
    pending.catch(() => {
      pending = null;
    });
    return pending;
  };

  function Lazy(props: P) {
    const [, loaded] = useReducer((n: number) => n + 1, 0);
    const Ready = Loaded;
    useEffect(() => {
      if (Ready) return;
      let live = true;
      preload().then(
        () => live && loaded(),
        () => undefined
      );
      return () => {
        live = false;
      };
    }, [Ready]);
    if (Ready) return <Ready {...props} />;
    return Fallback ? <Fallback /> : null;
  }

  return Object.assign(Lazy, { preload });
}
