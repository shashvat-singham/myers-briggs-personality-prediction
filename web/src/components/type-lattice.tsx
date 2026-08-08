"use client";

import Link from "next/link";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useRef, useState } from "react";
import typeIndex from "@/data/type-index.json";
import { temperament, TEMPERAMENT_STYLE } from "@/lib/scoring";
import { cn } from "./ui";

/**
 * The sixteen types as a 4×4 lattice, ordered so each row is one temperament.
 * Tilts toward the pointer and lifts the hovered cell — the whole grid is the
 * hero's visual anchor and also a working index into the profiles.
 */
const ORDER = (["NF", "NT", "SJ", "SP"] as const).flatMap((group) =>
  typeIndex.filter((t) => temperament(t.type) === group),
);

export function TypeLattice() {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Raw pointer offset from the centre, in the range −0.5…0.5.
  const px = useMotionValue(0);
  const py = useMotionValue(0);

  // Spring the rotation rather than the pointer so the tilt settles instead of
  // snapping, and returns to flat on leave.
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [8, -8]), {
    stiffness: 120,
    damping: 18,
  });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-10, 10]), {
    stiffness: 120,
    damping: 18,
  });

  const hoveredEntry = ORDER.find((t) => t.type === hovered);

  return (
    <div className="w-full" style={{ perspective: 1000 }}>
      <motion.div
        ref={ref}
        onPointerMove={(e) => {
          const box = ref.current?.getBoundingClientRect();
          if (!box) return;
          px.set((e.clientX - box.left) / box.width - 0.5);
          py.set((e.clientY - box.top) / box.height - 0.5);
        }}
        onPointerLeave={() => {
          px.set(0);
          py.set(0);
          setHovered(null);
        }}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="grid grid-cols-4 gap-2.5"
      >
        {ORDER.map((t, i) => {
          const style = TEMPERAMENT_STYLE[temperament(t.type)];
          const isHovered = hovered === t.type;

          return (
            <motion.div
              key={t.type}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.03, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformStyle: "preserve-3d" }}
            >
              <Link
                href={`/types/${t.type}`}
                onPointerEnter={() => setHovered(t.type)}
                aria-label={`${t.type} — ${t.epithet}`}
                className={cn(
                  "glass grid aspect-square place-items-center rounded-2xl transition duration-200",
                  isHovered ? "bg-white/10" : "hover:bg-white/8",
                )}
                style={{ transform: isHovered ? "translateZ(28px)" : "translateZ(0)" }}
              >
                <span className={cn("font-mono text-sm font-semibold sm:text-base", style.text)}>
                  {t.type}
                </span>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Reserve the caption's height so the lattice never shifts on hover. */}
      <div className="mt-5 h-10 text-center">
        <motion.p
          key={hoveredEntry?.type ?? "idle"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="text-sm text-mute"
        >
          {hoveredEntry ? (
            <>
              <span className="text-chalk">{hoveredEntry.epithet}</span>
              <span className="text-faint"> · {hoveredEntry.nameDescription}</span>
            </>
          ) : (
            <span className="text-faint">
              Four temperaments, four types each. Hover to read one.
            </span>
          )}
        </motion.p>
      </div>
    </div>
  );
}
