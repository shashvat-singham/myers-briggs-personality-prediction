import questions from "@/data/questions.json";
import type { Axis, AxisKey, Letter, Question, TestResult } from "./types";

export const QUESTIONS = questions as Question[];

/** Points awarded for a strong endorsement. A slight one is worth 1. */
export const MAX_WEIGHT = 2;

/** The four dichotomies, in the order the result is spelled. */
export const AXES: { key: AxisKey; pair: [Letter, Letter]; label: [string, string] }[] = [
  { key: "EI", pair: ["E", "I"], label: ["Extraversion", "Introversion"] },
  { key: "SN", pair: ["S", "N"], label: ["Sensing", "Intuition"] },
  { key: "TF", pair: ["T", "F"], label: ["Thinking", "Feeling"] },
  { key: "JP", pair: ["J", "P"], label: ["Judging", "Perceiving"] },
];

export const LETTER_LABEL: Record<Letter, string> = {
  E: "Extraversion",
  I: "Introversion",
  S: "Sensing",
  N: "Intuition",
  T: "Thinking",
  F: "Feeling",
  J: "Judging",
  P: "Perceiving",
};

export const AXIS_OF: Record<Letter, AxisKey> = {
  E: "EI",
  I: "EI",
  S: "SN",
  N: "SN",
  T: "TF",
  F: "TF",
  J: "JP",
  P: "JP",
};

/** Item counts per axis — 10 for E/I, 20 for the other three. */
export const AXIS_ITEMS: Record<AxisKey, number> = AXES.reduce(
  (acc, axis) => {
    acc[axis.key] = QUESTIONS.filter((q) => q.poles[0].score === axis.pair[0]).length;
    return acc;
  },
  {} as Record<AxisKey, number>,
);

const EMPTY_TALLY = (): Record<Letter, number> => ({
  E: 0,
  I: 0,
  S: 0,
  N: 0,
  T: 0,
  F: 0,
  J: 0,
  P: 0,
});

/**
 * Tally weighted points and resolve each dichotomy.
 *
 * `answers` maps a question number to the index of the picked option (0–3);
 * unanswered items simply do not contribute, so a partial run still scores.
 *
 * A strong endorsement is worth 2 points and a slight one 1, so an axis with N
 * items ranges over 0–2N per pole. `percent` is the winner's share of the
 * weight actually cast, which means an axis answered entirely with "slightly"
 * reads the same as one answered entirely with "strongly" — the difference
 * shows up only when the two poles are mixed, which is exactly when magnitude
 * carries information.
 *
 * Ties break toward the second letter of the pair (I/N/F/P), the convention the
 * source instrument uses when the count is even.
 */
export function score(answers: Record<number, number>) {
  const tally = EMPTY_TALLY();

  for (const q of QUESTIONS) {
    const picked = answers[q.no];
    if (picked === undefined) continue;
    const option = q.options[picked];
    if (option) tally[option.score] += option.weight;
  }

  const axes: Axis[] = AXES.map(({ key, pair }) => {
    const [a, b] = pair;
    const items = AXIS_ITEMS[key];
    const tied = tally[a] === tally[b];
    const winner = tally[a] > tally[b] ? a : b;
    const loser = winner === a ? b : a;
    const winnerScore = tally[winner];
    const answeredScore = tally[a] + tally[b];
    const percent = answeredScore === 0 ? 50 : Math.round((winnerScore / answeredScore) * 100);

    return {
      key,
      winner,
      loser,
      winnerScore,
      answeredScore,
      items,
      percent,
      strength: Math.round(Math.abs(percent - 50) * 2),
      tied,
    };
  });

  return { type: axes.map((a) => a.winner).join(""), axes, tally };
}

export function buildResult(
  answers: Record<number, number>,
  durationMs: number,
  now: number,
  meta: Pick<TestResult, "source" | "persona"> = {},
): Omit<TestResult, "id"> {
  const { type, axes, tally } = score(answers);
  return {
    type,
    axes,
    tally,
    answers,
    durationMs,
    createdAt: now,
    source: meta.source ?? "manual",
    ...(meta.persona ? { persona: meta.persona } : {}),
  };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Temperament grouping (Keirsey), used to give each type a consistent accent
 * colour across the landing page, history rows and the result page.
 */
export function temperament(type: string): "NF" | "NT" | "SJ" | "SP" {
  const [, s, t, j] = type;
  if (s === "N") return t === "F" ? "NF" : "NT";
  return j === "J" ? "SJ" : "SP";
}

export const TEMPERAMENT_STYLE: Record<
  ReturnType<typeof temperament>,
  { name: string; text: string; from: string; to: string }
> = {
  NF: { name: "Idealist", text: "text-violet-300", from: "from-violet-500", to: "to-fuchsia-400" },
  NT: { name: "Rational", text: "text-cyan-300", from: "from-cyan-500", to: "to-sky-400" },
  SJ: { name: "Guardian", text: "text-amber-300", from: "from-amber-500", to: "to-orange-400" },
  SP: { name: "Artisan", text: "text-rose-300", from: "from-rose-500", to: "to-pink-400" },
};

export function typeStyle(type: string) {
  return TEMPERAMENT_STYLE[temperament(type)];
}
