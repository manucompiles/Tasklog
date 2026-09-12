"use client";

// Top-level section tabs in the site header (v3.0): Tasks, Time, Journal.
// Until now cross-section navigation lived only in the home sidebar, so on
// mobile the other sections were dead ends. The header is the one surface
// every page shares.

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Tasks", isActive: (p: string) => p === "/" || p.startsWith("/tasks") },
  { href: "/time", label: "Time", isActive: (p: string) => p.startsWith("/time") },
  { href: "/journal", label: "Journal", isActive: (p: string) => p.startsWith("/journal") },
  { href: "/companion", label: "Sage", isActive: (p: string) => p.startsWith("/companion") },
  { href: "/projects", label: "Projects", isActive: (p: string) => p.startsWith("/projects") },
  { href: "/profile", label: "Profile", isActive: (p: string) => p.startsWith("/profile") },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    // A swipeable strip on narrow screens: when the tabs fit they sit centered
    // (the wrapper centers a content-width nav); when they don't, the nav takes
    // max-w-full and scrolls horizontally INSIDE itself - the page body must
    // never scroll sideways (ux rule no-horizontal-scroll).
    <nav
      aria-label="Sections"
      className="flex items-center gap-1 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map(({ href, label, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap px-2.5 sm:px-3 py-2 rounded-lg text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active
                ? "bg-surface-raised text-text-primary font-semibold"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
