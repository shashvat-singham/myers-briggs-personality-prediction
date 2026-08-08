import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { LoginPanel } from "./login-panel";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to keep your MBTI results and compare them over time.",
};

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-20">
      <Suspense
        fallback={
          <div className="grid h-64 place-items-center">
            <Spinner />
          </div>
        }
      >
        <LoginPanel />
      </Suspense>
    </div>
  );
}
