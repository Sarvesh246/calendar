"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useDatebookStore } from "@/lib/store";

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

  useEffect(() => {
    if (!supabase) return;

    const sync = (nextUser: User | null) => {
      setUser(nextUser);
      if (nextUser && connectedFor.current !== nextUser.id) {
        connectedFor.current = nextUser.id;
        void connectCloud(nextUser.id);
      } else if (!nextUser && connectedFor.current) {
        connectedFor.current = null;
        disconnectCloud();
      }
    };

    supabase.auth.getSession().then(({ data }) => sync(data.session?.user ?? null));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      sync(session?.user ?? null);
    });

    return () => sub.subscription.unsubscribe();
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
