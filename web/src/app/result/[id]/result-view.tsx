"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, Clock, RefreshCw, Save, Sparkles } from "lucide-react";
import { AxisBars } from "@/components/axis-bars";
import { TypeProfileView } from "@/components/type-profile";
import { ButtonLink, Card, Eyebrow, Spinner, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { getResult, readPendingResult } from "@/lib/results";
import { formatDuration, TEMPERAMENT_STYLE, temperament, typeStyle } from "@/lib/scoring";
import type { TestResult, TypeProfile } from "@/lib/types";

type State =
  | { status: "loading" }
  | { status: "ready"; result: TestResult; profile: TypeProfile; local: boolean }
  | { status: "error"; message: string };

const DATE = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ResultView({ id }: { id: string }) {
  const { user, loading: authLoading, configured } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    // `local` results live in this browser only and need no auth; everything
    // else is keyed by uid, so wait for the auth state to settle first.
    if (id !== "local" && authLoading) return;

    let cancelled = false;

    (async () => {
      try {
        const result =
          id === "local" ? readPendingResult() : user ? await getResult(user.uid, id) : null;

        if (!result) {
          if (cancelled) return;
          setState({
            status: "error",
            message:
              id === "local"
                ? "There's no unsaved result in this browser. It may have been saved to your account already."
                : user
                  ? "That result doesn't exist, or it belongs to a different account."
                  : "Sign in to open a saved result.",
          });
          return;
        }

        const res = await fetch(`/types/${result.type}.json`);
        if (!res.ok) throw new Error(`profile ${result.type} -> ${res.status}`);
        const profile = (await res.json()) as TypeProfile;

        if (!cancelled) {
          setState({ status: "ready", result, profile, local: id === "local" });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Couldn't load this result. Please try again." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, user, authLoading]);

  if (state.status === "loading") {
    return (
      <div className="grid h-96 place-items-center">
        <Spinner />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <Card className="p-8 text-center">
          <AlertCircle className="mx-auto size-6 text-amber-300" />
          <p className="mt-4 text-mute">{state.message}</p>
          <div className="mt-6 flex justify-center gap-3">
            <ButtonLink href="/test">Take the test</ButtonLink>
            {!user && configured && (
              <ButtonLink href={`/login?next=/result/${id}`} variant="outline">
                Sign in
              </ButtonLink>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const { result, profile, local } = state;
  const style = typeStyle(result.type);
  const group = TEMPERAMENT_STYLE[temperament(result.type)];

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      {/* ------------------------------------------------------- verdict --- */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="animate-rise">
          <Eyebrow>
            {temperament(result.type)} · {group.name}
          </Eyebrow>
          <h1
            className={cn(
              "mt-5 font-mono text-7xl leading-none font-semibold tracking-tight sm:text-9xl",
              style.text,
            )}
          >
            {result.type}
          </h1>
          <p className="mt-4 text-2xl font-medium">{profile.epithet}</p>
          <p className="mt-1 text-mute">{profile.name}</p>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-faint">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" /> {formatDuration(result.durationMs)} taken
            </span>
            <span>{DATE.format(new Date(result.createdAt))}</span>
            <Link href="/test" className="flex items-center gap-1.5 transition hover:text-chalk">
              <RefreshCw className="size-3.5" /> Retake
            </Link>
          </div>

          {/* A generated sheet is not a person's answers — say so on the result
              itself, not only in the history list. */}
          {result.source && result.source !== "manual" && (
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/8 px-3.5 py-1.5 text-xs text-mute">
              <Sparkles className="size-3.5 text-violet-300" />
              {result.source === "ai" ? "Answered by AI" : "Simulated locally"}
              {result.persona && <span className="text-chalk">as {result.persona}</span>}
            </p>
          )}
        </div>

        <Card className="animate-rise p-6" style={{ animationDelay: "80ms" }}>
          <h2 className="text-sm font-medium tracking-wide text-mute uppercase">Your margins</h2>
          <div className="mt-5">
            <AxisBars axes={result.axes} />
          </div>
        </Card>
      </div>

      {/* --------------------------------------------------- save prompt --- */}
      {local && configured && (
        <Card className="mt-8 flex flex-col items-start gap-4 border-violet-400/25 bg-violet-500/8 p-6 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/8 text-violet-300">
            <Save className="size-5" />
          </span>
          <div className="flex-1">
            <p className="font-medium">This result isn&apos;t saved yet</p>
            <p className="mt-1 text-sm text-mute">
              It lives in this browser only. Sign in and it moves to your account, where it can be
              compared against future attempts.
            </p>
          </div>
          <ButtonLink href={`/login?next=/result/${id}`}>Save to my account</ButtonLink>
        </Card>
      )}

      {/* -------------------------------------------------- full profile --- */}
      <div className="mt-16">
        <TypeProfileView profile={profile} />
      </div>
    </div>
  );
}
