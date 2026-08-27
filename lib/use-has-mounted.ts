import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True only after client hydration — lets us defer client-only-safe content without a setState-in-effect. */
export function useHasMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
