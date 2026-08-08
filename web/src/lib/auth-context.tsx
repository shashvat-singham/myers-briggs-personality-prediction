"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth, isFirebaseConfigured } from "./firebase";

interface AuthValue {
  user: User | null;
  /** True until the first onAuthStateChanged callback lands. */
  loading: boolean;
  configured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Firebase error codes are not presentable; map the ones users actually hit. */
const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password combination doesn't match an account.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/user-not-found": "No account exists for that email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/email-already-in-use": "An account already exists for that email. Try signing in.",
  "auth/weak-password": "Passwords need to be at least six characters.",
  "auth/popup-closed-by-user": "The sign-in window was closed before finishing.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and retry.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/operation-not-allowed":
    "That sign-in method is disabled for this Firebase project. Enable it under Authentication → Sign-in method.",
  "auth/unauthorized-domain":
    "This domain isn't authorised in Firebase. Add it under Authentication → Settings → Authorized domains.",
};

export function friendlyAuthError(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
  return MESSAGES[code] ?? "Something went wrong signing you in. Please try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthValue>(() => {
    const need = () => {
      const auth = getFirebaseAuth();
      if (!auth) throw new Error("Firebase is not configured.");
      return auth;
    };

    return {
      user,
      loading,
      configured: isFirebaseConfigured,
      signInWithGoogle: async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(need(), provider);
      },
      signInWithEmail: async (email, password) => {
        await signInWithEmailAndPassword(need(), email.trim(), password);
      },
      signUpWithEmail: async (name, email, password) => {
        const cred = await createUserWithEmailAndPassword(need(), email.trim(), password);
        const displayName = name.trim();
        if (displayName) await updateProfile(cred.user, { displayName });
      },
      logout: async () => {
        await signOut(need());
      },
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
