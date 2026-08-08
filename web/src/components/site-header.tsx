"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, History, LogOut, Sparkles, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button, ButtonLink, cn, Spinner } from "./ui";

const LINKS = [
  { href: "/test", label: "Take the test" },
  { href: "/types", label: "The sixteen" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, configured, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the account menu on outside click and on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const initial = (user?.displayName || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-white/6 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-ink-950">
            <Sparkles className="size-4" strokeWidth={2.5} />
          </span>
          Sixteen
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition",
                pathname === link.href
                  ? "bg-white/8 text-chalk"
                  : "text-mute hover:bg-white/5 hover:text-chalk",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {loading ? (
            <Spinner className="size-5" />
          ) : user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="glass flex h-10 items-center gap-2 rounded-full pr-3 pl-1.5 text-sm transition hover:bg-white/8"
              >
                <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-xs font-semibold text-ink-950">
                  {initial}
                </span>
                <span className="hidden max-w-28 truncate sm:block">
                  {user.displayName || user.email}
                </span>
                <ChevronDown className="size-4 text-mute" />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="glass absolute right-0 mt-2 w-56 animate-rise overflow-hidden rounded-2xl p-1.5"
                >
                  <div className="truncate px-3 py-2 text-xs text-faint">{user.email}</div>
                  <Link
                    href="/history"
                    role="menuitem"
                    // Closed here rather than on a pathname effect: navigating
                    // to the page you are already on fires no route change, and
                    // the menu would stay open.
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-mute transition hover:bg-white/6 hover:text-chalk"
                  >
                    <History className="size-4" /> Your history
                  </Link>
                  <button
                    role="menuitem"
                    onClick={async () => {
                      await logout();
                      router.push("/");
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10"
                  >
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : configured ? (
            <ButtonLink href="/login" variant="outline" size="sm">
              <UserIcon className="size-4" /> Sign in
            </ButtonLink>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Set the NEXT_PUBLIC_FIREBASE_* environment variables to enable accounts."
            >
              Sign-in unavailable
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
