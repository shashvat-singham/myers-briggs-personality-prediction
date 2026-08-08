"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PERSONAS, simulateAnswers, type Persona } from "@/lib/personas";
import { savePendingResult, saveResult } from "@/lib/results";
import { buildResult, formatDuration, QUESTIONS, score } from "@/lib/scoring";
import { Button, Card, cn, Spinner } from "@/components/ui";
import type { TestResult } from "@/lib/types";

const DRAFT_KEY = "mbti:draft";

interface Draft {
  answers: Record<number, number>;
  index: number;
  startedAt: number;
  source?: TestResult["source"];
  persona?: string;
}

const HINTS = [
  "There are no right answers. Nothing here is scored as better than anything else.",
  "Answer quickly. Some wordings are awkward — go with whichever side feels closer rather than parsing them.",
  "Answer as the way you are, not the way you would like to be seen.",
];

/**
 * Option indices per pole, laid out so the four buttons read 1–4 left to right
 * across the pair — strongest A on the far left, strongest B on the far right,
 * with the two slight options meeting in the middle. That mirrors the shape of
 * the scale, and makes the number keys match what the eye sees.
 */
const POLE_OPTIONS: { pole: 0 | 1; order: number[] }[] = [
  { pole: 0, order: [0, 1] },
  { pole: 1, order: [2, 3] },
];

const INTENSITY_LABEL = ["Strongly", "Slightly", "Slightly", "Strongly"] as const;

export function TestRunner() {
  const router = useRouter();
  const { user } = useAuth();

  const [ready, setReady] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [index, setIndex] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [direction, setDirection] = useState(1);

  const [source, setSource] = useState<TestResult["source"]>("manual");
  const [persona, setPersona] = useState<string | undefined>();
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const autoRef = useRef<HTMLDivElement>(null);

  const total = QUESTIONS.length;
  const question = QUESTIONS[index];
  const answered = Object.keys(answers).length;
  const complete = answered === total;

  /* -------------------------------------------------- restore a draft ---
     Seeding mutable state from localStorage after mount. It cannot move into
     the initialiser: localStorage does not exist during the server render, so
     reading it there would desync hydration. An external-store subscription
     does not fit either — the draft has to become editable state, not a
     read-only snapshot. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Draft;
        if (draft.answers && Object.keys(draft.answers).length > 0) {
          setAnswers(draft.answers);
          setIndex(Math.min(draft.index ?? 0, total - 1));
          setStartedAt(draft.startedAt ?? Date.now());
          setSource(draft.source ?? "manual");
          setPersona(draft.persona);
          setShowIntro(false);
        }
      }
    } catch {
      // A corrupt draft is not worth surfacing — start clean.
    }
    setReady(true);
  }, [total]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready || startedAt === null) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ answers, index, startedAt, source, persona } satisfies Draft),
      );
    } catch {
      /* quota — the run still works, it just won't survive a refresh */
    }
  }, [ready, answers, index, startedAt, source, persona]);

  /* --------------------------------------------------------- the clock --- */
  useEffect(() => {
    if (startedAt === null || showIntro) return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, showIntro]);

  useEffect(() => {
    if (!autoOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!autoRef.current?.contains(e.target as Node)) setAutoOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [autoOpen]);

  const goto = useCallback(
    (next: number) => {
      setDirection(next > index ? 1 : -1);
      setIndex(Math.max(0, Math.min(total - 1, next)));
    },
    [index, total],
  );

  const choose = useCallback(
    (option: number) => {
      setAnswers((prev) => ({ ...prev, [question.no]: option }));
      // Any manual answer makes the sheet the user's own, not the model's.
      setSource("manual");
      setPersona(undefined);
      if (index < total - 1) window.setTimeout(() => goto(index + 1), 200);
    },
    [question.no, index, total, goto],
  );

  /* ----------------------------------------------------- the auto-fill --- */
  const autofill = useCallback(async (chosen?: Persona) => {
    setAutoBusy(true);
    setAutoOpen(false);
    setNotice(null);
    try {
      const response = await fetch("/api/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: chosen?.id }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          answers: Record<number, number>;
          persona: string;
          reasoning?: string;
        };
        setAnswers(data.answers);
        setSource("ai");
        setPersona(data.persona);
        setNotice(
          data.reasoning
            ? `AI answered as ${data.persona}. ${data.reasoning}`
            : `AI answered as ${data.persona}.`,
        );
        setIndex(total - 1);
        return;
      }

      throw new Error(String(response.status));
    } catch {
      // No key, no network, or a bad sheet — the local simulator still produces
      // a coherent respondent, so the demo path never dead-ends.
      const fallbackPersona = chosen ?? PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
      setAnswers(simulateAnswers());
      setSource("simulated");
      setPersona(fallbackPersona.label);
      setNotice(
        `The model wasn't reachable, so this sheet was simulated locally as ${fallbackPersona.label}.`,
      );
      setIndex(total - 1);
    } finally {
      setAutoBusy(false);
    }
  }, [total]);

  /* --------------------------------------------------------- submitting --- */
  const finish = useCallback(async () => {
    if (!complete || submitting) return;
    setSubmitting(true);

    const result = buildResult(answers, Date.now() - (startedAt ?? Date.now()), Date.now(), {
      source,
      persona,
    });

    try {
      if (user) {
        const id = await saveResult(user.uid, result);
        localStorage.removeItem(DRAFT_KEY);
        router.push(`/result/${id}`);
      } else {
        savePendingResult(result);
        localStorage.removeItem(DRAFT_KEY);
        router.push("/result/local");
      }
    } catch {
      // A database outage should cost the sync, not the fifteen minutes.
      savePendingResult(result);
      localStorage.removeItem(DRAFT_KEY);
      router.push("/result/local");
    }
  }, [complete, submitting, answers, startedAt, source, persona, user, router]);

  /* ------------------------------------------------ keyboard shortcuts --- */
  useEffect(() => {
    if (showIntro || !ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (["1", "2", "3", "4"].includes(e.key)) choose(Number(e.key) - 1);
      else if (e.key === "ArrowLeft") goto(index - 1);
      else if (e.key === "ArrowRight") goto(index + 1);
      else if (e.key === "Enter" && complete) finish();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showIntro, ready, index, complete, choose, goto, finish]);

  const firstUnanswered = useMemo(
    () => QUESTIONS.findIndex((q) => answers[q.no] === undefined),
    [answers],
  );

  // Live verdict from whatever has been answered so far — the axis only firms up
  // once enough of its items are in, so unanswered axes read as a dash.
  const preview = useMemo(() => {
    const { axes } = score(answers);
    return axes.map((axis) =>
      axis.answeredScore >= axis.items ? axis.winner : "·",
    );
  }, [answers]);

  if (!ready) {
    return (
      <div className="grid h-96 place-items-center">
        <Spinner />
      </div>
    );
  }

  /* ------------------------------------------------------ instructions --- */
  if (showIntro) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20">
        <Card className="p-8 sm:p-10">
          <span className="grid size-11 place-items-center rounded-2xl bg-white/6 text-amber-300">
            <Lightbulb className="size-5" />
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Before you start</h1>
          <p className="mt-3 text-mute">
            {total} items, roughly fifteen minutes. Each one gives you two opposing statements and
            four ways to answer — pick a side, then say how strongly.
          </p>
          <ul className="mt-6 space-y-3">
            {HINTS.map((hint, i) => (
              <li key={hint} className="flex gap-3 text-sm leading-relaxed text-mute">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/8 font-mono text-[11px] text-chalk">
                  {i + 1}
                </span>
                {hint}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-faint">
            Progress is kept in this browser, so you can close the tab and pick it up later.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              className="flex-1"
              onClick={() => {
                setStartedAt(Date.now());
                setShowIntro(false);
              }}
            >
              Okay, I&apos;ve got it <ArrowRight className="size-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setStartedAt(Date.now());
                setShowIntro(false);
                autofill();
              }}
            >
              <Wand2 className="size-4" /> Let AI fill it
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------------- test --- */
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      {/* header: counter, live verdict, clock, auto-fill */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="font-mono text-sm text-mute">
          <span className="text-chalk">{String(index + 1).padStart(2, "0")}</span>
          <span className="text-faint"> / {total}</span>
        </div>

        <div className="flex items-center gap-1" aria-label="Result so far">
          {preview.map((letter, i) => (
            <motion.span
              key={`${i}-${letter}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "grid size-7 place-items-center rounded-lg font-mono text-sm font-semibold",
                letter === "·" ? "bg-white/5 text-faint" : "bg-white/10 text-chalk",
              )}
            >
              {letter}
            </motion.span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-mute tabular-nums">
            <Clock className="size-4" />
            {formatDuration(elapsed)}
          </span>

          <div className="relative" ref={autoRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoOpen((v) => !v)}
              disabled={autoBusy}
              aria-haspopup="menu"
              aria-expanded={autoOpen}
            >
              {autoBusy ? <Spinner className="size-4" /> : <Wand2 className="size-4" />}
              Auto
              <ChevronDown className="size-3.5 text-faint" />
            </Button>

            <AnimatePresence>
              {autoOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="glass absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl p-1.5"
                >
                  <p className="px-3 py-2 text-xs leading-relaxed text-faint">
                    The model sits the whole instrument in character, so the sheet stays internally
                    consistent instead of reading as noise.
                  </p>
                  <button
                    role="menuitem"
                    onClick={() => autofill()}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/8"
                  >
                    <Sparkles className="size-4 text-violet-300" />
                    Surprise me
                  </button>
                  <div className="my-1 h-px bg-white/8" />
                  <div className="max-h-64 overflow-y-auto">
                    {PERSONAS.map((p) => (
                      <button
                        key={p.id}
                        role="menuitem"
                        onClick={() => autofill(p)}
                        className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/8"
                      >
                        <span className="block text-sm">{p.label}</span>
                        <span className="block text-xs text-faint">{p.blurb}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
          animate={{ width: `${(answered / total) * 100}%` }}
          initial={false}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-violet-400/25 bg-violet-500/8 px-4 py-3 text-sm leading-relaxed text-mute">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-300" />
              <span>{notice}</span>
              <button
                onClick={() => setNotice(null)}
                className="ml-auto shrink-0 text-xs text-faint transition hover:text-chalk"
              >
                Dismiss
              </button>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The item. A fixed floor keeps the nav buttons from jumping between a
          one-line item and a four-line one, without the dead space a taller
          reservation leaves under short items. */}
      <div className="relative mt-8 min-h-[19rem]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={question.no}
            initial={{ opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -28 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="text-2xl leading-snug font-medium text-balance sm:text-3xl">
              {question.question}
            </h1>

            <div className="mt-7 grid gap-3 md:grid-cols-2">
              {POLE_OPTIONS.map(({ pole, order }) => {
                const statement = question.poles[pole];
                const active = order.includes(answers[question.no]);

                return (
                  <motion.div
                    key={statement.score}
                    animate={{ scale: active ? 1 : 0.995 }}
                    className={cn(
                      "flex flex-col rounded-2xl border p-5 transition-colors",
                      active
                        ? "border-violet-400/50 bg-violet-500/10"
                        : "border-white/10 bg-white/3 hover:border-white/18",
                    )}
                  >
                    <p className="flex-1 text-base leading-relaxed">{statement.answer}</p>

                    <div className="mt-5 grid grid-cols-2 gap-2">
                      {order.map((idx) => {
                        const selected = answers[question.no] === idx;
                        return (
                          <button
                            key={idx}
                            onClick={() => choose(idx)}
                            aria-pressed={selected}
                            className={cn(
                              "relative h-11 rounded-xl border text-sm font-medium transition active:scale-[0.97]",
                              selected
                                ? "border-transparent bg-gradient-to-r from-violet-500 to-cyan-400 text-ink-950 shadow-lg shadow-violet-900/30"
                                : "border-white/12 text-mute hover:border-white/25 hover:bg-white/6 hover:text-chalk",
                            )}
                          >
                            <span className="flex items-center justify-center gap-1.5">
                              {selected && <Check className="size-3.5" strokeWidth={3} />}
                              {INTENSITY_LABEL[idx]}
                            </span>
                            <span className="absolute top-1 right-2 font-mono text-[10px] text-current opacity-40">
                              {idx + 1}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite">
        Item {index + 1} of {total}. {answered} answered.
      </p>

      {/* navigation */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => goto(index - 1)} disabled={index === 0}>
          <ArrowLeft className="size-4" /> Previous
        </Button>

        {complete ? (
          <Button onClick={finish} disabled={submitting} size="lg">
            {submitting ? <Spinner className="size-4" /> : <Check className="size-4" />}
            See your result
          </Button>
        ) : index === total - 1 ? (
          <Button variant="outline" onClick={() => goto(firstUnanswered)}>
            <RotateCcw className="size-4" /> {total - answered} left — jump to the first
          </Button>
        ) : (
          <Button variant="outline" onClick={() => goto(index + 1)}>
            Next <ArrowRight className="size-4" />
          </Button>
        )}
      </div>

      {/* jump grid */}
      <div className="mt-12">
        <div className="mb-3 flex items-center justify-between text-xs text-faint">
          <span>Jump to an item</span>
          <span className="hidden sm:block">
            Keys: <kbd className="font-mono text-mute">1</kbd>–
            <kbd className="font-mono text-mute">4</kbd> to answer,{" "}
            <kbd className="font-mono text-mute">←</kbd>{" "}
            <kbd className="font-mono text-mute">→</kbd> to move
          </span>
        </div>
        <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-[repeat(18,minmax(0,1fr))]">
          {QUESTIONS.map((q, i) => {
            const done = answers[q.no] !== undefined;
            return (
              <button
                key={q.no}
                onClick={() => goto(i)}
                aria-label={`Item ${q.no}${done ? ", answered" : ""}`}
                aria-current={i === index}
                className={cn(
                  "grid aspect-square place-items-center rounded-md font-mono text-[10px] transition hover:scale-110",
                  i === index
                    ? "bg-gradient-to-br from-violet-500 to-cyan-400 text-ink-950"
                    : done
                      ? "bg-white/14 text-chalk hover:bg-white/20"
                      : "bg-white/5 text-faint hover:bg-white/10",
                )}
              >
                {q.no}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
