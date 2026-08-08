import type { Metadata } from "next";
import { TestRunner } from "./test-runner";

export const metadata: Metadata = {
  title: "Take the test",
  description: "Seventy forced-choice questions. About fifteen minutes.",
};

export default function TestPage() {
  return <TestRunner />;
}
