"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listResults } from "@/lib/results";
import { AXES, LETTER_LABEL, formatDuration, typeStyle } from "@/lib/scoring";
import type { TestResult, TypeProfile } from "@/lib/types";
import { Markdown } from "./markdown";
import { cn } from "./ui";

type Msg = { role: "user" | "model"; text: string };

const SUGGESTIONS_WITH_RESULT = [
  "What does my result actually say about me?",
  "Which of my axes is weakest, and what does that mean?",
  "How do I work well with the opposite type?",
  "Has my type changed between attempts?",
];

const SUGGESTIONS_EMPTY = [
  "What is the difference between Sensing and Intuition?",
  "How is this test scored?",
  "How reliable is MBTI, really?",
  "Which type should I read about first?",
];

const DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/**
 * In-app assistant. Rendered only for signed-in users — every answer is
 * grounded in that account's own results, so there is nothing useful to say
 * before sign-in and no reason to show the control.
 */
export function Assistant() {
  const { user, loading } = useAuth();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [profile, setProfile] = useState<TypeProfile | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* Load the grounding data once the panel is first opened, not on every page
     view — most sessions never open it, and this is two network round trips. */
  useEffect(() => {
    if (!open || !user || results !== null) return;
    let cancelled = false;

    (async () => {
      try {
        const rows = await listResults(user.uid, 20);
        if (cancelled) return;
        setResults(rows);

        if (rows[0]) {
          const res = await fetch(`/types/${rows[0].type}.json`);
          if (res.ok && !cancelled) setProfile((await res.json()) as TypeProfile);
        }
      } catch {
        // Without grounding the assistant still answers about the instrument
        // itself; an empty snapshot is a degraded answer, not a failure.
        if (!cancelled) setResults([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user, results]);

  /** Compact snapshot of this account's results — the grounding context. */
  const snapshot = useCallback((): string => {
    const lines: string[] = [];
    const rows = results ?? [];

    if (rows.length === 0) {
      lines.push("This user has not completed the test yet — no results on file.");
    } else {
      const latest = rows[0];
      lines.push(
        `Latest result: ${latest.type}${profile ? ` (${profile.epithet}, ${profile.name})` : ""}, taken ${DATE.format(
          new Date(latest.createdAt),
        )} in ${formatDuration(latest.durationMs)}.`,
      );
      if (latest.source && latest.source !== "manual") {
        lines.push(
          `Note: that sheet was ${
            latest.source === "ai" ? "answered by a model" : "simulated locally"
          }${latest.persona ? ` as "${latest.persona}"` : ""}, not by the user.`,
        );
      }

      for (const axis of latest.axes) {
        const meta = AXES.find((a) => a.key === axis.key);
        lines.push(
          `- ${meta?.label[0]} vs ${meta?.label[1]}: ${
            axis.tied
              ? "an exact tie"
              : `${axis.winner} (${LETTER_LABEL[axis.winner]}) at ${axis.percent}%, strength ${axis.strength}/100`
          }, from ${axis.items} items.`,
        );
      }

      const weakest = [...latest.axes].sort((a, b) => a.strength - b.strength)[0];
      lines.push(
        `Weakest axis: ${weakest.winner}/${weakest.loser} at strength ${weakest.strength}/100 — treat this one as unresolved.`,
      );

      if (rows.length > 1) {
        const types = rows.map((r) => `${r.type} (${DATE.format(new Date(r.createdAt))})`);
        lines.push(`All ${rows.length} attempts, newest first: ${types.join(", ")}.`);
        const distinct = new Set(rows.map((r) => r.type)).size;
        lines.push(
          distinct > 1
            ? `The type has varied across attempts (${distinct} distinct results).`
            : "The type has been stable across every attempt.",
        );
      } else {
        lines.push("Only one attempt on file, so there is no drift to report yet.");
      }
    }

    if (profile) {
      const fn = profile.jungianFunctionalPreference;
      lines.push(
        "",
        `# Profile for ${profile.type}`,
        `Function stack: dominant ${fn.dominant}, auxiliary ${fn.auxiliary}, tertiary ${fn.tertiary}, inferior ${fn.inferior}.`,
        `Overview: ${profile.description.split("\n\n").slice(0, 2).join(" ")}`,
        `Strengths: ${profile.strengths.slice(0, 6).join("; ")}`,
        `Relationship strengths: ${profile.relationshipStrengths.slice(0, 5).join("; ")}`,
        `Relationship weaknesses: ${profile.relationshipWeaknesses.slice(0, 5).join("; ")}`,
        `Success, as this type defines it: ${profile.successDefinition.split("\n\n")[0]}`,
      );
    }

    lines.push(
      "",
      "# How this instrument is scored",
      "70 forced-choice items: 10 on E/I and 20 each on S/N, T/F and J/P. Each item offers two opposing statements with four responses — strongly or slightly toward either pole — worth 2 and 1 points. An axis reports the winner's share of the weight cast, so 50% is a dead tie and 100% would be every item answered strongly one way. Exact ties resolve toward I, N, F or P.",
    );

    return lines.join("\n");
  }, [results, profile]);

  const ask = useCallback(
    async (raw?: string) => {
      const question = (raw ?? input).trim();
      if (!question || busy || !user) return;

      setInput("");
      setError(null);
      const history = msgs.slice(-6);
      setMsgs((m) => [...m, { role: "user", text: question }]);
      setBusy(true);

      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, question, context: snapshot(), history }),
        });

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "The assistant is unavailable.");
        }

        // Append the reply as it streams so the first words land immediately.
        setMsgs((m) => [...m, { role: "model", text: "" }]);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMsgs((m) => {
            const next = [...m];
            const last = next.length - 1;
            if (next[last]?.role === "model") {
              next[last] = { ...next[last], text: next[last].text + chunk };
            }
            return next;
          });
        }
      } catch (err) {
        setError((err as Error).message);
        setMsgs((m) => (m[m.length - 1]?.text === "" ? m.slice(0, -1) : m));
      } finally {
        setBusy(false);
      }
    },
    [input, busy, user, msgs, snapshot],
  );

  if (loading || !user) return null;

  const latest = results?.[0];
  const suggestions = latest ? SUGGESTIONS_WITH_RESULT : SUGGESTIONS_EMPTY;
  const firstName = user.displayName?.split(" ")[0];

  return (
    <>
      <motion.button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        aria-expanded={open}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          "fixed right-5 bottom-5 z-50 grid size-14 place-items-center rounded-full shadow-xl shadow-violet-900/30 transition",
          open
            ? "glass text-chalk"
            : "bg-gradient-to-br from-violet-500 to-cyan-400 text-ink-950",
        )}
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-6" strokeWidth={2.2} />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Assistant"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass fixed right-5 bottom-24 z-50 flex max-h-[min(34rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl shadow-2xl shadow-black/50"
          >
            <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-ink-950">
                <Sparkles className="size-4" strokeWidth={2.5} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Assistant</p>
                <p className="truncate text-xs text-faint">
                  {latest ? (
                    <>
                      Grounded in your{" "}
                      <span className={cn("font-mono", typeStyle(latest.type).text)}>
                        {latest.type}
                      </span>{" "}
                      result
                    </>
                  ) : (
                    "Ask about the instrument or the sixteen types"
                  )}
                </p>
              </div>
            </div>

            <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
              {msgs.length === 0 && (
                <div>
                  <p className="text-mute">
                    Hi{firstName ? ` ${firstName}` : ""} — ask me anything about your result or how
                    the test works.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        className="rounded-full border border-white/12 px-3 py-1.5 text-left text-xs text-mute transition hover:border-violet-400/50 hover:bg-white/6 hover:text-chalk"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {msgs.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2.5",
                    m.role === "user"
                      ? "ml-auto bg-gradient-to-br from-violet-500/25 to-cyan-400/20 text-chalk"
                      : "bg-white/5 text-mute",
                  )}
                >
                  {m.role === "model" ? <Markdown text={m.text} /> : m.text}
                </div>
              ))}

              {busy && msgs[msgs.length - 1]?.text === "" && (
                <div className="flex w-fit gap-1.5 rounded-2xl bg-white/5 px-4 py-3.5">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="size-1.5 rounded-full bg-mute"
                      animate={{ opacity: [0.25, 1, 0.25] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}

              {error && (
                <p className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-white/8 p-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask about your result…"
                aria-label="Ask the assistant"
                className="h-10 flex-1 rounded-xl border border-white/10 bg-white/4 px-3.5 text-sm transition placeholder:text-faint focus:border-violet-400/50 focus:outline-none"
              />
              <button
                onClick={() => ask()}
                disabled={busy || !input.trim()}
                aria-label="Send"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-ink-950 transition hover:brightness-110 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
