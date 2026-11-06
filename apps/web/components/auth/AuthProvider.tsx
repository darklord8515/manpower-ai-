"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, setSessionEndedHandler } from "@/lib/api";
import type { DemoRole, Me } from "@/lib/api-types";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null; reason?: "expired" | "signed-out" }
  | { status: "signed-in"; user: Me };

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<Me>;
  demoSignIn: (role: DemoRole) => Promise<Me>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The signed-in user must exist; only call inside the signed-in app shell. */
export function useUser(): Me {
  const { user } = useAuth();
  if (!user) throw new Error("useUser needs a signed-in user");
  return user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  // Who is signed in? Asked once when the app opens; the API is the source of truth.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((user) => !cancelled && setState({ status: "signed-in", user }))
      .catch(() => !cancelled && setState({ status: "anonymous", user: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 after that means the session ended. The shell then sends the person to sign in, saying why.
  useEffect(() => {
    setSessionEndedHandler(() => setState({ status: "anonymous", user: null, reason: "expired" }));
    return () => setSessionEndedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const user = await api.login(email, password);
    setState({ status: "signed-in", user });
    return user;
  }, []);

  const demoSignIn = useCallback(async (role: DemoRole) => {
    const user = await api.demoLogin(role);
    setState({ status: "signed-in", user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      // A session that is already gone is the same as signed out.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    setState({ status: "anonymous", user: null, reason: "signed-out" });
  }, []);

  const value = useMemo(
    () => ({ ...state, signIn, demoSignIn, signOut }),
    [state, signIn, demoSignIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
