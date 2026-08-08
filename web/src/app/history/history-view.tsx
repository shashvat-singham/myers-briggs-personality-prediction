"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Clock, Sparkles, Trash2 } from "lucide-react";
import { AxisBars } from "@/components/axis-bars";
import { Button, ButtonLink, Card, Spinner, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { deleteResult, listResults } from "@/lib/results";
import { formatDuration, typeStyle } from "@/lib/scoring";
import type { TestResult } from "@/lib/types";

const DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function HistoryView() {
  const { user, loading: authLoading, configured } = useAuth();
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async (uid: string) => {
    try {
      setResults(await listResults(uid));
      setError(null);
    } catch {
      setError("Couldn't reach the database. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    // The setState inside `load` runs after an await, not synchronously — the
    // lint rule cannot see through the async boundary. Fetching on mount is
    // what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(user.uid);
  }, [user, authLoading, load]);

  async function remove(id: string) {
    if (!user) return;
    setRemoving(id);
    try {
      await deleteResult(user.uid, id);
      setResults((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } catch {
      setError("Couldn't delete that result. Please try again.");
    } finally {
      setRemoving(null);
    }
  }

  if (authLoading) {
    return (
      <div className="grid h-96 place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">Sign in to see your history</h1>
          <p className="mt-3 text-sm text-mute">
            Results are private to your account, so there is nothing to show until you sign in.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {configured ? (
              <ButtonLink href="/login?next=/history">Sign in</ButtonLink>
            ) : (
              <ButtonLink href="/test">Take the test</ButtonLink>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // Distinct types across all attempts — the interesting number is whether the
  // result is stable, not what it was on any single day.
  const distinct = new Set(results?.map((r) => r.type) ?? []).size;

  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Your history</h1>
          <p className="mt-2 text-mute">
            {results === null
              ? "Loading your attempts…"
              : results.length === 0
                ? "No attempts yet."
                : `${results.length} attempt${results.length === 1 ? "" : "s"}` +
                  (distinct > 1 ? ` · ${distinct} different types` : " · consistent so far")}
          </p>
        </div>
        <ButtonLink href="/test" variant="outline">
          Take it again
        </ButtonLink>
      </div>

      {error && (
        <p className="mt-6 flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      )}

      {results === null ? (
        <div className="mt-16 grid place-items-center">
          <Spinner />
        </div>
      ) : results.length === 0 ? (
        <Card className="mt-8 p-10 text-center">
          <p className="text-mute">
            Once you finish a test it appears here, newest first, with the margins on each
            dichotomy.
          </p>
          <ButtonLink href="/test" className="mt-6">
            Take the test
          </ButtonLink>
        </Card>
      ) : (
        <ul className="mt-8 space-y-4">
          {results.map((result) => {
            const style = typeStyle(result.type);
            return (
              <li key={result.id}>
                <Card className="group relative overflow-hidden p-6 transition hover:bg-white/6">
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                    <Link
                      href={`/result/${result.id}`}
                      className="flex flex-1 items-center gap-5"
                      aria-label={`Open the ${result.type} result from ${DATE.format(new Date(result.createdAt))}`}
                    >
                      <span
                        className={cn(
                          "font-mono text-3xl font-semibold tabular-nums",
                          style.text,
                        )}
                      >
                        {result.type}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm">
                          {DATE.format(new Date(result.createdAt))}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-faint">
                          <span className="flex items-center gap-1.5">
                            <Clock className="size-3.5" /> {formatDuration(result.durationMs)}
                          </span>
                          {result.source && result.source !== "manual" && (
                            <span className="flex items-center gap-1 text-violet-300/80">
                              <Sparkles className="size-3" />
                              {result.persona ?? (result.source === "ai" ? "AI" : "Simulated")}
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>

                    <div className="w-full sm:w-56">
                      <AxisBars axes={result.axes} compact />
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => remove(result.id)}
                        disabled={removing === result.id}
                        aria-label="Delete this result"
                      >
                        {removing === result.id ? (
                          <Spinner className="size-4" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                      <ChevronRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-mute" />
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
