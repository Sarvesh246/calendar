"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useDatebookStore } from "@/lib/store";

interface AuthContextValue {
  /** null = signed out; undefined = still resolving the initial session. */
  user: User | null | undefined;
  configured: boolean;
  sending: boolean;
  /** Send a magic-link email. Resolves on success, throws with a message on failure. */
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  configured: false,
  sending: false,
  signInWithEmail: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(
    isSupabaseConfigured ? undefined : null
  );
  const [sending, setSending] = useState(false);
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
    sending,
    signInWithEmail: async (email) => {
      if (!supabase) throw new Error("Cloud sync isn't configured.");
      setSending(true);
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw new Error(error.message);
      } finally {
        setSending(false);
      }
    },
    signOut: async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
