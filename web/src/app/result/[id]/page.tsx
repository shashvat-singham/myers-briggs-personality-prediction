import type { Metadata } from "next";
import { ResultView } from "./result-view";

export const metadata: Metadata = {
  title: "Your result",
  description: "Your Myers–Briggs type, the margin on each dichotomy, and the full profile.",
  robots: { index: false },
};

export default async function ResultPage({ params }: PageProps<"/result/[id]">) {
  const { id } = await params;
  return <ResultView id={id} />;
}
