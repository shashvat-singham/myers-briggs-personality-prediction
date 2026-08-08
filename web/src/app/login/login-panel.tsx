"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, Sparkles } from "lucide-react";
import { friendlyAuthError, useAuth } from "@/lib/auth-context";
import { adoptPendingResult, readPendingResult } from "@/lib/results";
import { Button, Card, cn, Spinner } from "@/components/ui";

type Mode = "signin" | "signup";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4h6.6c-.1 1.1-.9 2.8-2.5 3.9l3.8 3c2.3-2.1 3.6-5.2 3.6-8.7Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-3c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-3.9 3A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.2 14.3a7.4 7.4 0 0 1 0-4.6l-4-3a12 12 0 0 0 0 10.6l4-3Z" />
      <path
        fill="#EA4335"
        d="M12 4.7c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.7l3.9 3C6.1 6.8 8.8 4.7 12 4.7Z"
      />
    </svg>
  );
}

export function LoginPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, configured, signInWithGoogle, signInWithEmail, signUpWithEmail } =
    useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = params.get("next") ?? "/history";

  /* Whether a signed-out result is waiting to be adopted. localStorage does not
     exist during the server render, so this is read through an external-store
     subscription with an explicit server snapshot rather than in an effect —
     the server and the first client render then agree, and the value settles
     without a second render pass. Nothing writes the key while this panel is
     mounted, so the subscription never has to fire. */
  const hasPending = useSyncExternalStore(
    () => () => {},
    () => Boolean(readPendingResult()),
    () => false,
  );

  /**
   * Once signed in, adopt any result taken while signed out and leave. The
   * adopted id wins over `next` so the user lands on the result they just
   * finished rather than a history list they have to scan.
   */
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      let destination = next;
      try {
        const adopted = await adoptPendingResult(user.uid);
        if (adopted) destination = `/result/${adopted}`;
      } catch {
        // A failed adoption must not strand the user on the login screen; the
        // local copy stays put and can be retried from the result page.
      }
      if (!cancelled) router.replace(destination);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, next, router]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold">Accounts aren&apos;t configured</h1>
        <p className="mt-3 text-sm leading-relaxed text-mute">
          This deployment has no Firebase credentials, so sign-in is switched off. Set the{" "}
          <code className="font-mono text-xs text-chalk">NEXT_PUBLIC_FIREBASE_*</code> environment
          variables and redeploy. The test itself still works — results are kept in this browser.
        </p>
      </Card>
    );
  }

  if (loading || user) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 text-ink-950">
          <Sparkles className="size-5" strokeWidth={2.5} />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm text-mute">
          {hasPending
            ? "Sign in and the result you just finished is saved to your history."
            : "Your results are private to your account."}
        </p>
      </div>

      <Card className="mt-8 p-6">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-white/5 p-1">
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={cn(
                "h-9 rounded-full text-sm font-medium transition",
                mode === m ? "bg-white/10 text-chalk" : "text-mute hover:text-chalk",
              )}
            >
              {m === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          className="mt-5 w-full"
          disabled={busy}
          onClick={() => run(signInWithGoogle)}
        >
          <GoogleMark /> Continue with Google
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-white/8" />
          or use email
          <span className="h-px flex-1 bg-white/8" />
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              mode === "signin"
                ? signInWithEmail(email, password)
                : signUpWithEmail(name, email, password),
            );
          }}
        >
          {mode === "signup" && (
            <Field
              label="Name"
              type="text"
              value={name}
              onChange={setName}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          )}
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            required
          />

          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Spinner className="size-4" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </Card>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-mute">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-white/10 bg-white/4 px-3.5 text-sm transition placeholder:text-faint focus:border-violet-400/50 focus:bg-white/6 focus:outline-none"
      />
    </label>
  );
}
