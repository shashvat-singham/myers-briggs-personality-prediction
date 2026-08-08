import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-lg shadow-violet-900/30 hover:brightness-110",
  outline: "glass text-chalk hover:bg-white/8",
  ghost: "text-mute hover:text-chalk hover:bg-white/5",
  danger: "text-rose-300 hover:bg-rose-500/10",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const SIZES = { sm: "h-9 px-4", md: "h-11 px-6", lg: "h-13 px-8 text-base" } as const;

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <Link className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("glass rounded-3xl", className)} {...props} />;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-mute uppercase">
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80",
        className,
      )}
    />
  );
}
