import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { AXES, AXIS_ITEMS, MAX_WEIGHT, QUESTIONS } from "@/lib/scoring";
import { Card, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How this instrument is constructed and scored: item counts per dichotomy, the graded forced-choice response format, the weighting scheme, tie handling, and what the result does and doesn't support.",
};

/** Where the items and the profile text in this application actually came from. */
const SOURCES = [
  {
    title: "The Personality Page — type portraits",
    href: "https://www.personalitypage.com/html/ENFJ.html",
    note: "The sixteen profiles rendered on the result page — the description, strengths, relationship patterns, problem areas and ten rules — are reproduced from this source.",
  },
  {
    title: "Humanmetrics — Jung Typology Test",
    href: "https://www.humanmetrics.com/personality",
    note: "The public 70-item forced-choice questionnaire this item bank follows, with 10 items on E/I and 20 on each of the other three dichotomies.",
  },
];

const REFERENCES = [
  {
    title: "Myers, I. B. & Myers, P. B. — Gifts Differing: Understanding Personality Type",
    href: "https://openlibrary.org/works/OL3589631W",
    note: "The type framework this instrument operationalises.",
  },
  {
    title: "Jung, C. G. — Psychological Types (Collected Works, Vol. 6)",
    href: "https://press.princeton.edu/books/paperback/9780691018133/collected-works-of-c-g-jung-volume-6",
    note: "Origin of the attitude and function distinctions behind the four dichotomies.",
  },
  {
    title: "Pittenger, D. J. (2005) — Cautionary comments regarding the Myers-Briggs Type Indicator",
    href: "https://doi.org/10.1037/1065-9293.57.3.210",
    note: "Consulting Psychology Journal 57(3), 210–221. The standard psychometric critique.",
  },
  {
    title:
      "McCrae, R. R. & Costa, P. T. (1989) — Reinterpreting the MBTI from the perspective of the Five-Factor Model",
    href: "https://doi.org/10.1111/j.1467-6494.1989.tb00759.x",
    note: "Journal of Personality 57(1), 17–40. Maps the four dichotomies onto FFM dimensions.",
  },
  {
    title: "Myers–Briggs Type Indicator — overview and criticism",
    href: "https://en.wikipedia.org/wiki/Myers%E2%80%93Briggs_Type_Indicator",
    note: "A general entry point, with the reliability and validity literature collected in one place.",
  },
];

export default function MethodologyPage() {
  const totalItems = QUESTIONS.length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <Eyebrow>
        <FlaskConical className="size-3.5" /> Methodology
      </Eyebrow>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        How the instrument is built and scored
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mute">
        Everything below is the actual implementation, not a description of one. The item bank, the
        weighting, and the tie rule are read from the same module the test runs on.
      </p>

      <div className="mt-14 space-y-14">
        {/* ------------------------------------------------ the item bank --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">1. The item bank</h2>
          <p className="mt-4 leading-relaxed text-mute">
            {totalItems} items, each probing exactly one dichotomy. The items are unevenly
            distributed by design — the extraversion–introversion axis is the shortest, and the
            other three carry twice as many items each.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs tracking-wide text-faint uppercase">
                  <th className="py-3 pr-4 font-medium">Dichotomy</th>
                  <th className="py-3 pr-4 font-medium">Poles</th>
                  <th className="py-3 pr-4 font-medium">Items</th>
                  <th className="py-3 font-medium">Max points per pole</th>
                </tr>
              </thead>
              <tbody>
                {AXES.map((axis) => (
                  <tr key={axis.key} className="border-b border-white/6">
                    <td className="py-3 pr-4">
                      {axis.label[0]} vs {axis.label[1]}
                    </td>
                    <td className="py-3 pr-4 font-mono text-mute">
                      {axis.pair[0]} / {axis.pair[1]}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-mute">{AXIS_ITEMS[axis.key]}</td>
                    <td className="py-3 tabular-nums text-mute">
                      {AXIS_ITEMS[axis.key] * MAX_WEIGHT}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-faint">
            Because the axes differ in length, raw point totals are not comparable across axes.
            Every figure the result page reports is normalised to the weight actually cast on that
            axis, which is what makes the four margins readable side by side.
          </p>
        </section>

        {/* --------------------------------------------- response format --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">2. Graded forced choice</h2>
          <p className="mt-4 leading-relaxed text-mute">
            The published instrument is binary: two statements, pick one. That discards magnitude —
            a respondent who barely leans extraverted and one who is emphatically extraverted score
            identically. This implementation splits each pole into two response strengths, giving
            four options per item:
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { i: 1, label: "Strongly A", weight: 2 },
              { i: 2, label: "Slightly A", weight: 1 },
              { i: 3, label: "Slightly B", weight: 1 },
              { i: 4, label: "Strongly B", weight: 2 },
            ].map((o) => (
              <Card key={o.i} className="flex items-center gap-4 p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/8 font-mono text-xs">
                  {o.i}
                </span>
                <span className="flex-1 text-sm">{o.label}</span>
                <span className="font-mono text-sm text-violet-300">{o.weight} pt</span>
              </Card>
            ))}
          </div>

          <p className="mt-6 leading-relaxed text-mute">
            There is deliberately no neutral midpoint. Five- and seven-point Likert scales invite
            central-tendency bias — respondents cluster on the midpoint to avoid committing, and the
            item stops discriminating. Keeping the choice forced while grading its intensity
            preserves the discrimination and recovers the magnitude the binary format threw away.
          </p>
        </section>

        {/* -------------------------------------------------- the scoring --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">3. Scoring</h2>
          <p className="mt-4 leading-relaxed text-mute">
            Each answered item adds its weight to its pole. For a dichotomy with poles{" "}
            <span className="font-mono text-chalk">a</span> and{" "}
            <span className="font-mono text-chalk">b</span>:
          </p>

          <pre className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-white/3 p-5 font-mono text-sm leading-relaxed text-mute">
            {`score(a) = Σ weight(i)  for every item i answered toward a
winner   = argmax(score(a), score(b))
percent  = round(100 × score(winner) / (score(a) + score(b)))
strength = 2 × |percent − 50|`}
          </pre>

          <p className="mt-5 leading-relaxed text-mute">
            <span className="text-chalk">percent</span> is bounded below at 50 by construction — it
            is the winner&apos;s share, so it answers &ldquo;how lopsided was this axis&rdquo;, not
            &ldquo;how extraverted are you&rdquo;.{" "}
            <span className="text-chalk">strength</span> rescales the same quantity onto 0–100,
            where 0 is a dead tie and 100 means every item on the axis was answered strongly toward
            one pole. The bars on the result page render <span className="text-chalk">strength</span>{" "}
            outward from the centre.
          </p>

          <p className="mt-5 leading-relaxed text-mute">
            Denominators use the weight <em>actually cast</em>, not the theoretical maximum, so a
            partially completed sheet still scores correctly rather than reading as artificially
            balanced.
          </p>

          <h3 className="mt-8 text-lg font-medium">Ties</h3>
          <p className="mt-3 leading-relaxed text-mute">
            An exact tie resolves toward the second letter of the pair — I, N, F or P — the
            convention the source instrument uses when the count is even. The result page labels a
            tied axis as <span className="font-mono text-chalk">even</span> rather than reporting a
            spurious 50/50 preference, because a tie is genuinely an absence of signal on that axis
            and should not be read as a type assignment.
          </p>
        </section>

        {/* --------------------------------------------------- auto-fill --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">4. Model-generated responses</h2>
          <p className="mt-4 leading-relaxed text-mute">
            The auto-fill control has a language model complete the whole sheet in character as a named
            persona. It sees all {totalItems} items in one pass rather than being sampled per item,
            which is what keeps the answers internally consistent — a respondent who leans one way
            on an axis should lean the same way across the other items probing it, and independent
            per-item sampling does not produce that.
          </p>
          <p className="mt-4 leading-relaxed text-mute">
            When the model is unreachable, a local simulator draws a hidden true type plus a
            per-axis conviction and answers probabilistically from it. Both paths are recorded on
            the stored result — <span className="font-mono text-chalk">ai</span> or{" "}
            <span className="font-mono text-chalk">simulated</span> — and neither is ever presented
            as a human response. Answering any item by hand reverts the sheet to{" "}
            <span className="font-mono text-chalk">manual</span>.
          </p>
          <p className="mt-4 leading-relaxed text-mute">
            This exists for demonstration and for exercising the scoring pipeline end to end.
            Generated sheets are not data about anyone and should not be pooled with real responses.
          </p>
        </section>

        {/* --------------------------------------------------- limitations --- */}
        <section>
          <Card className="border-amber-400/25 bg-amber-500/6 p-7">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-white/8 text-amber-300">
                <AlertTriangle className="size-4.5" />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">5. What this does not support</h2>
            </div>
            <p className="mt-5 leading-relaxed text-mute">
              The MBTI framework is widely used and widely criticised, and it is worth being
              specific about which criticisms apply here.
            </p>
            <ul className="mt-5 space-y-4 text-sm leading-relaxed text-mute">
              <li>
                <span className="text-chalk">The underlying traits are continuous, not bimodal.</span>{" "}
                Scores on each axis distribute unimodally around the middle. Cutting at the midpoint
                assigns a discrete letter to a continuum, which means respondents near the cut point
                are assigned almost arbitrarily — and most respondents are near a cut point on at
                least one axis. The margin figures are reported precisely so a narrow axis is
                visible rather than hidden behind a letter.
              </li>
              <li>
                <span className="text-chalk">Test–retest reliability is moderate.</span> A
                substantial fraction of respondents receive a different four-letter type on retest
                weeks later, usually because one narrow axis flipped. This is the reason results are
                stored as a history rather than a single verdict — the drift is the informative part.
              </li>
              <li>
                <span className="text-chalk">
                  Predictive validity for job performance is not established.
                </span>{" "}
                Nothing here should inform hiring, placement, or any consequential decision about
                another person.
              </li>
              <li>
                <span className="text-chalk">This is not the licensed MBTI® instrument.</span> The
                items come from a freely circulated public questionnaire in the same tradition. No
                claim of equivalence to the commercial instrument is made or implied, and MBTI is a
                trademark of its respective owner.
              </li>
            </ul>
          </Card>
        </section>

        {/* ------------------------------------------------------ privacy --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">6. Data handling</h2>
          <p className="mt-4 leading-relaxed text-mute">
            Results are written to Firebase Realtime Database under{" "}
            <span className="font-mono text-chalk">users/&lt;uid&gt;/results</span> and are readable
            and writable only by the account that produced them; the database rules deny everything
            else by default. A test taken while signed out never leaves the browser until you sign
            in and choose to keep it. Deleting a result from your history removes the record.
          </p>
        </section>

        {/* ------------------------------------------------------- sources --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">
            7. Where the material comes from
          </h2>
          <p className="mt-4 leading-relaxed text-mute">
            Neither the items nor the profile text are original to this project. Both are
            reproduced from freely circulated public material in the Myers–Briggs tradition, and
            the sources are named here rather than buried in a footer.
          </p>
          <ul className="mt-6 space-y-4">
            {SOURCES.map((s) => (
              <li key={s.title} className="border-l-2 border-violet-400/40 pl-4">
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm leading-relaxed underline decoration-white/25 underline-offset-4 transition hover:text-chalk"
                >
                  {s.title} ↗
                </a>
                <p className="mt-1 text-sm text-faint">{s.note}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* --------------------------------------------------- references --- */}
        <section>
          <h2 className="text-2xl font-semibold tracking-tight">References</h2>
          <ul className="mt-5 space-y-4">
            {REFERENCES.map((ref) => (
              <li key={ref.title} className="border-l-2 border-white/10 pl-4">
                <a
                  href={ref.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm leading-relaxed underline decoration-white/20 underline-offset-4 transition hover:text-chalk"
                >
                  {ref.title} ↗
                </a>
                <p className="mt-1 text-sm text-faint">{ref.note}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-16 flex flex-wrap gap-4 border-t border-white/8 pt-8 text-sm text-mute">
        <Link href="/test" className="transition hover:text-chalk">
          Take the test →
        </Link>
        <Link href="/types" className="transition hover:text-chalk">
          Browse the sixteen profiles →
        </Link>
      </div>
    </div>
  );
}
