export type Letter = "E" | "I" | "S" | "N" | "T" | "F" | "J" | "P";

export type AxisKey = "EI" | "SN" | "TF" | "JP";

export interface Option {
  answer: string;
  score: Letter;
  /** 2 for a strong endorsement, 1 for a slight one. */
  weight: 1 | 2;
  intensity: "Strongly" | "Slightly";
}

export interface Question {
  no: number;
  question: string;
  /** The two opposing statements, in option order. */
  poles: { score: Letter; answer: string }[];
  /** Fixed order: [strong A, slight A, slight B, strong B]. Stored answers are these indices. */
  options: Option[];
}

/** One dichotomy, resolved. */
export interface Axis {
  key: AxisKey;
  winner: Letter;
  loser: Letter;
  /** Weighted points for the winning pole. */
  winnerScore: number;
  /** Weighted points across both poles — 2 × the number of items answered. */
  answeredScore: number;
  /** Number of items on this axis (not weighted). */
  items: number;
  /** 0–100, the winner's share of the answered weight. Never below 50. */
  percent: number;
  /** 0–100 preference strength: 0 = a dead tie, 100 = every item strongly one way. */
  strength: number;
  tied: boolean;
}

export interface TestResult {
  id: string;
  type: string;
  axes: Axis[];
  /** Weighted points per letter, so a result re-renders without the answers. */
  tally: Record<Letter, number>;
  /** Question number -> index of the chosen option (0–3). */
  answers: Record<number, number>;
  durationMs: number;
  createdAt: number;
  /** How the answers were produced. Absent on older records; treat as "manual". */
  source?: "manual" | "ai" | "simulated";
  /** The persona the auto-fill answered as, when source is not "manual". */
  persona?: string;
}

/** Shape of `public/types/<TYPE>.json`. */
export interface TypeProfile {
  type: string;
  name: string;
  nameDescription: string;
  epithet: string;
  description: string;
  jungianFunctionalPreference: {
    dominant: string;
    auxiliary: string;
    tertiary: string;
    inferior: string;
  };
  generalTraits: string[];
  relationshipStrengths: string[];
  relationshipWeaknesses: string[];
  successDefinition: string;
  strengths: string[];
  gifts: string[];
  potentialProblemAreas: string[];
  explanationOfProblems: string;
  solutions: string;
  livingHappilyTips: string;
  tenRulesToLive: string[];
}
