import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { TypeProfileView } from "@/components/type-profile";
import { ButtonLink, Eyebrow, cn } from "@/components/ui";
import { loadProfile, TYPE_CODES } from "@/lib/profiles";
import { TEMPERAMENT_STYLE, temperament, typeStyle } from "@/lib/scoring";

export function generateStaticParams() {
  return TYPE_CODES.map((type) => ({ type }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/types/[type]">): Promise<Metadata> {
  const { type } = await params;
  const profile = await loadProfile(type);
  if (!profile) return { title: "Unknown type" };
  return {
    title: `${profile.type} — ${profile.epithet}`,
    description: profile.description.split("\n\n")[0].slice(0, 200),
  };
}

export default async function TypePage({ params }: PageProps<"/types/[type]">) {
  const { type } = await params;
  const profile = await loadProfile(type);
  if (!profile) notFound();

  const style = typeStyle(profile.type);
  const group = TEMPERAMENT_STYLE[temperament(profile.type)];

  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <header className="max-w-3xl">
        <Eyebrow>
          {temperament(profile.type)} · {group.name}
        </Eyebrow>
        <h1
          className={cn(
            "mt-5 font-mono text-6xl font-semibold tracking-tight sm:text-8xl",
            style.text,
          )}
        >
          {profile.type}
        </h1>
        <p className="mt-3 text-2xl font-medium">{profile.epithet}</p>
        <p className="mt-2 text-mute">{profile.name}</p>
        <p className="mt-1 text-sm text-faint">{profile.nameDescription}</p>

        <ButtonLink href="/test" className="mt-8">
          Is this you? Take the test <ArrowRight className="size-4" />
        </ButtonLink>
      </header>

      <div className="mt-16">
        <TypeProfileView profile={profile} />
      </div>
    </div>
  );
}
