import { AXIS_OF, AXES, QUESTIONS } from "./scoring";
import type { AxisKey, Letter } from "./types";

export interface Persona {
  id: string;
  label: string;
  blurb: string;
}

/**
 * Personas the auto-fill can answer as.
 *
 * They exist so a generated run reads like one coherent person rather than
 * seventy independent coin flips: real respondents lean consistently on an
 * axis, and a uniformly random sheet produces a near-tie on all four
 * dichotomies, which is the least interesting possible result.
 */
export const PERSONAS: Persona[] = [
  { id: "founder", label: "The founder", blurb: "Runs on momentum, decides fast, hates a stalled room." },
  { id: "researcher", label: "The researcher", blurb: "Reads the footnotes, distrusts a tidy conclusion." },
  { id: "counsellor", label: "The counsellor", blurb: "Reads the room before the agenda, remembers what people said." },
  { id: "operator", label: "The operator", blurb: "Owns the checklist, ships on the date, never drops a thread." },
  { id: "maker", label: "The maker", blurb: "Learns by building, improvises, resists the schedule." },
  { id: "analyst", label: "The analyst", blurb: "Reasons from first principles, argues with the premise." },
  { id: "organiser", label: "The organiser", blurb: "Keeps the group together and the calendar honest." },
  { id: "wanderer", label: "The wanderer", blurb: "Follows the interesting thread wherever it goes." },
];

export function randomPersona(): Persona {
  return PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
}

/**
 * Simulate a coherent respondent locally.
 *
 * Draws a hidden "true type" plus a per-axis conviction, then answers each item
 * by that axis's bias with noise, so the sheet holds together and the margins
 * land somewhere plausible instead of pinned at 100%. This is the fallback path
 * when the model API isn't reachable — it is labelled `simulated`, never `ai`.
 */
export function simulateAnswers(): Record<number, number> {
  const lean = {} as Record<AxisKey, { pole: Letter; conviction: number }>;

  for (const axis of AXES) {
    lean[axis.key] = {
      pole: axis.pair[Math.random() < 0.5 ? 0 : 1],
      // 0.55–0.9: strong enough to resolve the axis, loose enough to stay human.
      conviction: 0.55 + Math.random() * 0.35,
    };
  }

  const answers: Record<number, number> = {};

  for (const q of QUESTIONS) {
    const { pole, conviction } = lean[AXIS_OF[q.poles[0].score]];
    const agrees = Math.random() < conviction;
    const target: Letter = agrees ? pole : q.poles.find((p) => p.score !== pole)!.score;
    // Conviction also drives how often the pick is emphatic rather than slight.
    const strong = Math.random() < (agrees ? conviction : 1 - conviction);

    const index = q.options.findIndex(
      (o) => o.score === target && o.weight === (strong ? 2 : 1),
    );
    answers[q.no] = index >= 0 ? index : 1;
  }

  return answers;
}

/** Compact prompt form of the instrument — one line per item, no option prose. */
export function questionsForPrompt(): string {
  return QUESTIONS.map(
    (q) => `${q.no}. ${q.question} A = "${q.poles[0].answer}" | B = "${q.poles[1].answer}"`,
  ).join("\n");
}
