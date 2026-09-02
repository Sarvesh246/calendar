"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useDatebookStore } from "@/lib/store";
import { subscribePush } from "@/lib/push-client";
import { notificationPermission } from "@/lib/reminders";

interface AuthContextValue {
  /** null = signed out; undefined = still resolving the initial session. */
  user: User | null | undefined;
  configured: boolean;
  signingIn: boolean;
  /** Redirect to Google, then back to the app signed in. */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  configured: false,
  signingIn: false,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(
    isSupabaseConfigured ? undefined : null
  );
  const [signingIn, setSigningIn] = useState(false);
  const connectCloud = useDatebookStore((s) => s.connectCloud);
  const disconnectCloud = useDatebookStore((s) => s.disconnectCloud);
  const connectedFor = useRef<string | null>(null);
  const hydrated = useRef(false);
  const pendingAuthUser = useRef<User | null | "unset">("unset");

  useEffect(() => {
    if (!supabase) return;

    const applyAuth = (nextUser: User | null) => {
      setUser(nextUser);
      const run = () => {
        if (nextUser && connectedFor.current !== nextUser.id) {
          connectedFor.current = nextUser.id;
          void connectCloud(nextUser.id);
          if (notificationPermission() === "granted") {
            void subscribePush();
          }
        } else if (!nextUser && connectedFor.current) {
          connectedFor.current = null;
          void disconnectCloud();
        }
      };
      // Defer cloud connect until after first paint so launch stays snappy.
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(run, { timeout: 2500 });
      } else {
        setTimeout(run, 400);
      }
    };

    const sync = (nextUser: User | null) => {
      if (!hydrated.current) {
        pendingAuthUser.current = nextUser;
        return;
      }
      applyAuth(nextUser);
    };

    const start = () => {
      if (hydrated.current || !supabase) return;
      hydrated.current = true;
      if (pendingAuthUser.current !== "unset") {
        applyAuth(pendingAuthUser.current);
        pendingAuthUser.current = "unset";
      } else {
        supabase.auth.getSession().then(({ data }) => applyAuth(data.session?.user ?? null));
      }
    };

    const persist = useDatebookStore.persist;
    let unsubHydration: (() => void) | undefined;
    if (persist.hasHydrated()) {
      start();
    } else {
      unsubHydration = persist.onFinishHydration(start);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // The realtime socket authenticates once, at join time. When the access
      // token is rotated (roughly hourly) the socket keeps using the old one and
      // eventually gets dropped mid-session — live updates would quietly stop on
      // a tab that had been open a while. Hand it the fresh token instead.
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        void supabase?.realtime.setAuth();
      }
      sync(session?.user ?? null);
    });

    return () => {
      unsubHydration?.();
      sub.subscription.unsubscribe();
    };
  }, [connectCloud, disconnectCloud]);

  const value: AuthContextValue = {
    user,
    configured: isSupabaseConfigured,
    signingIn,
    signInWithGoogle: async () => {
      if (!supabase) throw new Error("Cloud sync isn't configured.");
      setSigningIn(true);
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin,
            queryParams: { prompt: "select_account" },
          },
        });
        if (error) throw new Error(error.message);
        // On success the browser is navigating away to Google.
      } catch (err) {
        setSigningIn(false);
        throw err;
      }
    },
    signOut: async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
