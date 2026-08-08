"use client";

import { useEffect, useState } from "react";
import { typeStyle } from "@/lib/scoring";
import type { TypeProfile } from "@/lib/types";
import { Card, cn } from "./ui";

type Section =
  | { id: string; title: string; kind: "prose"; body: string }
  | { id: string; title: string; kind: "list"; items: string[] }
  | { id: string; title: string; kind: "functions"; stack: TypeProfile["jungianFunctionalPreference"] };

/**
 * A list whose single entry is a wall of text is really prose that happened to
 * be stored in an array — render it as prose so it does not appear as one
 * enormous bullet.
 */
function listOrProse(id: string, title: string, items: string[]): Section {
  if (items.length === 1 && items[0].length > 400) {
    return { id, title, kind: "prose", body: items[0] };
  }
  return { id, title, kind: "list", items };
}

function sectionsFor(p: TypeProfile): Section[] {
  const all: Section[] = [
    { id: "overview", title: "Overview", kind: "prose", body: p.description },
    {
      id: "functions",
      title: "Cognitive functions",
      kind: "functions",
      stack: p.jungianFunctionalPreference,
    },
    listOrProse("traits", "General traits", p.generalTraits),
    listOrProse("relationship-strengths", "Relationship strengths", p.relationshipStrengths),
    listOrProse("relationship-weaknesses", "Relationship weaknesses", p.relationshipWeaknesses),
    { id: "success", title: "How you define success", kind: "prose", body: p.successDefinition },
    listOrProse("strengths", "Strengths", p.strengths),
    listOrProse("gifts", "Gifts", p.gifts),
    listOrProse("problem-areas", "Potential problem areas", p.potentialProblemAreas),
    { id: "explanation", title: "Where the problems come from", kind: "prose", body: p.explanationOfProblems },
    { id: "solutions", title: "Solutions", kind: "prose", body: p.solutions },
    { id: "living-happily", title: "Living happily as your type", kind: "prose", body: p.livingHappilyTips },
    listOrProse("rules", "Ten rules to live by", p.tenRulesToLive),
  ];

  // Profiles vary in which fields are populated; an empty section renders as a
  // heading with nothing under it, so drop those rather than show the gap.
  return all.filter((s) => {
    if (s.kind === "prose") return s.body.trim().length > 0;
    if (s.kind === "list") return s.items.length > 0;
    return true;
  });
}

const FUNCTION_ROLES = [
  ["dominant", "Dominant", "The one you lead with, and lean on under pressure."],
  ["auxiliary", "Auxiliary", "The supporting hand that balances the dominant."],
  ["tertiary", "Tertiary", "Reachable, but it takes conscious effort."],
  ["inferior", "Inferior", "Least developed — where stress tends to surface."],
] as const;

function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-4">
      {text.split("\n\n").map((para, i) => (
        <p key={i} className="leading-relaxed text-mute">
          {para}
        </p>
      ))}
    </div>
  );
}

export function TypeProfileView({ profile }: { profile: TypeProfile }) {
  const sections = sectionsFor(profile);
  const style = typeStyle(profile.type);
  const [active, setActive] = useState(sections[0]?.id ?? "");

  // Scroll spy for the sidebar. The top margin keeps a heading from counting as
  // "active" while it is still hidden behind the sticky header.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-88px 0px -60% 0px", threshold: 0 },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // `sections` is derived from `profile` and stable for a given type.
  }, [profile.type]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav className="hidden lg:block">
        <ul className="sticky top-24 space-y-0.5 border-l border-white/8 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={cn(
                  "-ml-px block border-l-2 py-1.5 pl-4 transition",
                  active === s.id
                    ? cn("border-current", style.text)
                    : "border-transparent text-faint hover:border-white/20 hover:text-mute",
                )}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-12">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="text-2xl font-semibold tracking-tight">{s.title}</h2>
            <div className="mt-4">
              {s.kind === "prose" && <Prose text={s.body} />}

              {s.kind === "list" && (
                <ul className="space-y-3">
                  {s.items.map((item, i) => (
                    <li key={i} className="flex gap-3 leading-relaxed text-mute">
                      <span
                        className={cn(
                          "mt-2.5 size-1.5 shrink-0 rounded-full bg-gradient-to-br",
                          style.from,
                          style.to,
                        )}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {s.kind === "functions" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {FUNCTION_ROLES.map(([key, label, note], i) => (
                    <Card key={key} className="p-5">
                      <div className="flex items-center gap-2 text-xs tracking-wide text-faint uppercase">
                        <span className="font-mono">{i + 1}</span>
                        {label}
                      </div>
                      <div className={cn("mt-2 text-lg font-medium", style.text)}>
                        {s.stack[key]}
                      </div>
                      <p className="mt-1.5 text-sm text-faint">{note}</p>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
