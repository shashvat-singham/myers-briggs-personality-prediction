import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { Assistant } from "@/components/assistant";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Sixteen — MBTI Personality Test",
    template: "%s · Sixteen",
  },
  description:
    "A 70-question Myers–Briggs assessment with a full type profile, saved to your account so you can watch your results change over time.",
  openGraph: {
    title: "Sixteen — MBTI Personality Test",
    description:
      "A 70-question Myers–Briggs assessment with a full type profile and a saved history.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="grain flex min-h-full flex-col">
        <div className="aurora" aria-hidden />
        <AuthProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          {/* Renders nothing until a user is signed in. */}
          <Assistant />
        </AuthProvider>
      </body>
    </html>
  );
}
