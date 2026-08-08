import Link from "next/link";
import { ArrowRight, Brain, ClipboardList, LineChart, ShieldCheck } from "lucide-react";
import typeIndex from "@/data/type-index.json";
import { AXES, QUESTIONS, typeStyle } from "@/lib/scoring";
import { TypeLattice } from "@/components/type-lattice";
import { ButtonLink, Card, Eyebrow, cn } from "@/components/ui";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Answer 70 forced choices",
    body: "Two options per question, no middle ground. It takes about fifteen minutes if you answer on instinct rather than deliberating.",
  },
  {
    icon: Brain,
    title: "Read the full profile",
    body: "Not four letters and a paragraph — cognitive function stack, strengths, blind spots, relationship patterns and ten rules to live by.",
  },
  {
    icon: LineChart,
    title: "Watch it move",
    body: "Every attempt is saved to your account. Type is less interesting than the drift between attempts, and you can only see drift if you keep the record.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------- hero --- */}
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-16 sm:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div>
          <div className="animate-rise">
            <Eyebrow>
              <span className="size-1.5 rounded-full bg-emerald-400" />
              {QUESTIONS.length} questions · 16 outcomes
            </Eyebrow>
          </div>

          <h1
            className="mt-6 animate-rise text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-7xl"
            style={{ animationDelay: "60ms" }}
          >
            Four letters that <span className="text-gradient">explain the room</span> you keep
            walking into.
          </h1>

          <p
            className="mt-6 max-w-xl animate-rise text-lg leading-relaxed text-mute"
            style={{ animationDelay: "120ms" }}
          >
            The Myers–Briggs indicator sorts preference, not ability. Answer honestly about how you
            actually are — not how you would like to be read — and the profile on the other side is
            uncomfortably specific.
          </p>

          <div
            className="mt-10 flex animate-rise flex-wrap items-center gap-3"
            style={{ animationDelay: "180ms" }}
          >
            <ButtonLink href="/test" size="lg">
              Start the test <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="/types" variant="outline" size="lg">
              Browse the sixteen
            </ButtonLink>
          </div>

          <p
            className="mt-6 flex animate-rise items-center gap-2 text-sm text-faint"
            style={{ animationDelay: "240ms" }}
          >
            <ShieldCheck className="size-4" />
            No account needed to take it. Sign in only if you want the result kept.
          </p>
          </div>

          {/* Hidden below lg: a pointer-tilt grid is meaningless on touch, and
              the same sixteen are listed in full further down the page. */}
          <div className="hidden lg:block">
            <TypeLattice />
          </div>
        </div>

        {/* The four dichotomies, as a strip of scales. */}
        <div className="mt-20 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AXES.map((axis, i) => (
            <Card
              key={axis.key}
              className="animate-rise p-5"
              style={{ animationDelay: `${300 + i * 60}ms` }}
            >
              <div className="flex items-baseline justify-between font-mono text-2xl font-semibold">
                <span>{axis.pair[0]}</span>
                <span className="text-sm text-faint">vs</span>
                <span>{axis.pair[1]}</span>
              </div>
              <div className="mt-3 h-px bg-gradient-to-r from-violet-500/60 via-white/10 to-cyan-500/60" />
              <div className="mt-3 flex justify-between text-xs text-mute">
                <span>{axis.label[0]}</span>
                <span>{axis.label[1]}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ how it works --- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Card key={title} className="p-7">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-white/6 text-violet-300">
                  <Icon className="size-5" />
                </span>
                <span className="font-mono text-sm text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mute">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- the sixteen --- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">The sixteen</h2>
            <p className="mt-2 text-mute">Four temperaments, four types each.</p>
          </div>
          <Link
            href="/types"
            className="text-sm text-mute transition hover:text-chalk"
          >
            See every profile →
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {typeIndex.map((t) => {
            const style = typeStyle(t.type);
            return (
              <Link
                key={t.type}
                href={`/types/${t.type}`}
                className="glass group rounded-2xl p-5 transition hover:-translate-y-0.5 hover:bg-white/8"
              >
                <div className={cn("font-mono text-xl font-semibold", style.text)}>{t.type}</div>
                <div className="mt-1 text-sm text-mute">{t.epithet}</div>
                <div
                  className={cn(
                    "mt-4 h-0.5 w-8 rounded-full bg-gradient-to-r transition-all group-hover:w-full",
                    style.from,
                    style.to,
                  )}
                />
              </Link>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ CTA --- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <Card className="relative overflow-hidden p-10 text-center sm:p-16">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-600/12 via-transparent to-cyan-500/12" />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Fifteen minutes. Then you have a vocabulary for it.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-mute">
              Answer quickly, go with what feels true, and don&apos;t optimise for the answer you
              want.
            </p>
            <ButtonLink href="/test" size="lg" className="mt-8">
              Start the test <ArrowRight className="size-4" />
            </ButtonLink>
          </div>
        </Card>
      </section>
    </>
  );
}
