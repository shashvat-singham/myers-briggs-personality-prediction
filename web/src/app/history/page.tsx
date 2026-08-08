import type { Metadata } from "next";
import { HistoryView } from "./history-view";

export const metadata: Metadata = {
  title: "Your history",
  description: "Every test you've taken, and how your type has drifted between attempts.",
  robots: { index: false },
};

export default function HistoryPage() {
  return <HistoryView />;
}
