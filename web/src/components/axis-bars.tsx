"use client";

import { motion } from "motion/react";
import { AXES, LETTER_LABEL, MAX_WEIGHT } from "@/lib/scoring";
import type { Axis } from "@/lib/types";
import { cn } from "./ui";

/**
 * One horizontal scale per dichotomy, filled from the centre toward the winning
 * pole. Centre-out rather than left-to-right because the meaningful quantity is
 * the *margin* between the two poles, not the raw score.
 */
export function AxisBars({ axes, compact = false }: { axes: Axis[]; compact?: boolean }) {
  return (
    <div className={cn("space-y-5", compact && "space-y-3")}>
      {axes.map((axis, i) => {
        const meta = AXES.find((a) => a.key === axis.key);
        if (!meta) return null;
        const [left, right] = meta.pair;
        const winsRight = axis.winner === right;
        const half = axis.strength / 2; // % of the full bar, measured from centre
        const maxScore = axis.items * MAX_WEIGHT;

        return (
          <div key={axis.key} className="group/axis">
            <div className="flex items-baseline justify-between text-sm">
              <span className={cn("font-mono font-semibold", !winsRight ? "text-chalk" : "text-faint")}>
                {left}
                {!compact && (
                  <span className="ml-2 font-sans text-xs font-normal text-faint">
                    {LETTER_LABEL[left]}
                  </span>
                )}
              </span>
              <span className="text-xs text-mute tabular-nums">
                {axis.tied ? "even" : `${axis.percent}%`}
              </span>
              <span className={cn("font-mono font-semibold", winsRight ? "text-chalk" : "text-faint")}>
                {!compact && (
                  <span className="mr-2 font-sans text-xs font-normal text-faint">
                    {LETTER_LABEL[right]}
                  </span>
                )}
                {right}
              </span>
            </div>

            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/6">
              <span className="absolute top-0 bottom-0 left-1/2 z-10 w-px -translate-x-1/2 bg-white/20" />
              <motion.span
                className={cn(
                  "absolute top-0 bottom-0 rounded-full bg-gradient-to-r",
                  winsRight
                    ? "left-1/2 from-violet-500 to-cyan-400"
                    : "right-1/2 from-cyan-400 to-violet-500",
                )}
                initial={{ width: 0 }}
                animate={{ width: `${half}%` }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 + i * 0.08 }}
              />
            </div>

            {!compact && (
              <p className="mt-1.5 text-xs text-faint">
                {axis.tied
                  ? `Split evenly at ${axis.winnerScore} points each. Ties resolve to ${axis.winner}.`
                  : `${axis.winnerScore} of ${maxScore} possible points leaned ${LETTER_LABEL[
                      axis.winner
                    ].toLowerCase()}, across ${axis.items} items.`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
