"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Wordmark from "./Wordmark";
import ConnectButton from "./ConnectButton";
import { IS_MAINNET } from "@/lib/constants";
import { cx } from "./ui";

export const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/gallery", label: "Gallery" },
  { href: "/launch", label: "Launch" },
  { href: "/docs", label: "Docs" },
] as const;

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape closes the mobile menu and hands focus back to its toggle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const linkClass = (href: string) =>
    cx(
      "rounded-full px-4 py-2 font-display text-base font-semibold transition-colors",
      pathname === href || pathname.startsWith(`${href}/`)
        ? "bg-brand/20 text-brand-soft"
        : "text-muted hover:bg-card-2 hover:text-text",
    );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="floorvault home" className="shrink-0 rounded-full" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname === n.href ? "page" : undefined}
              className={linkClass(n.href)}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span
            className={cx(
              "hidden rounded-full px-3 py-1 text-xs font-bold lg:inline-block",
              IS_MAINNET ? "bg-mint/15 text-mint" : "bg-lemon/15 text-lemon",
            )}
          >
            {IS_MAINNET ? "Monad mainnet" : "Monad testnet"}
          </span>
          <ConnectButton />
          <button
            ref={toggleRef}
            type="button"
            className="grid size-11 place-items-center rounded-full border-2 border-line text-text md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line px-4 pb-4 pt-2 md:hidden">
          <ul className="grid gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={pathname === n.href ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cx(linkClass(n.href), "block text-lg")}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
