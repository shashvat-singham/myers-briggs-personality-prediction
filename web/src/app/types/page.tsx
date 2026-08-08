import type { Metadata } from "next";
import Link from "next/link";
import typeIndex from "@/data/type-index.json";
import { TEMPERAMENT_STYLE, temperament } from "@/lib/scoring";
import { cn } from "@/components/ui";

export const metadata: Metadata = {
  title: "The sixteen types",
  description: "Every Myers–Briggs type, grouped by temperament, with the full profile behind each.",
};

const GROUPS = (["NF", "NT", "SJ", "SP"] as const).map((key) => ({
  key,
  style: TEMPERAMENT_STYLE[key],
  types: typeIndex.filter((t) => temperament(t.type) === key),
}));

export default function TypesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">The sixteen types</h1>
      <p className="mt-4 max-w-2xl text-lg text-mute">
        Grouped by temperament — the two middle letters do most of the sorting. Pick one to read
        the whole profile, or{" "}
        <Link href="/test" className="text-chalk underline decoration-white/25 underline-offset-4">
          take the test
        </Link>{" "}
        to find yours.
      </p>

      <div className="mt-14 space-y-14">
        {GROUPS.map(({ key, style, types }) => (
          <section key={key}>
            <div className="flex items-baseline gap-3">
              <h2 className={cn("font-mono text-2xl font-semibold", style.text)}>{key}</h2>
              <span className="text-lg text-mute">{style.name}s</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {types.map((t) => (
                <Link
                  key={t.type}
                  href={`/types/${t.type}`}
                  className="glass group flex flex-col rounded-3xl p-6 transition hover:-translate-y-1 hover:bg-white/8"
                >
                  <div className={cn("font-mono text-2xl font-semibold", style.text)}>{t.type}</div>
                  <div className="mt-1 font-medium">{t.epithet}</div>
                  <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-faint">{t.blurb}</p>
                  <span className="mt-auto pt-5 text-sm text-mute transition group-hover:text-chalk">
                    Read the profile →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
