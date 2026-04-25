"use client";

/**
 * Vertical navigation sidebar shown on large screens (≥ `lg` breakpoint).
 * Hidden on mobile — `BottomNav` is used instead.
 *
 * Highlights the active item by comparing the current pathname to each item's
 * `href` using a prefix match so nested routes also activate the parent item.
 */

import { usePathname, useRouter } from "next/navigation";
import React from "react";

/** A single navigation destination. */
type Item = {
  label: string;
  href: string;
  icon: (props: { className?: string }) => React.ReactNode;
};

/**
 * Returns the Tailwind class string for a nav item button based on whether
 * it is the currently active route.
 */
function cls(active: boolean) {
  return active
    ? "w-full flex items-center gap-3 rounded-xl bg-neutral-900 px-3 py-3 text-sm font-medium"
    : "w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-neutral-300 hover:bg-neutral-900 hover:text-neutral-50 transition";
}

const HomeIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-5 w-5"} viewBox="0 0 24 24" fill="none">
    <path
      d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const GridIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-5 w-5"} viewBox="0 0 24 24" fill="none">
    <path
      d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const CalendarIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-5 w-5"} viewBox="0 0 24 24" fill="none">
    <path
      d="M7 3v3m10-3v3M4.5 9h15M6 6h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const UsersIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-5 w-5"} viewBox="0 0 24 24" fill="none">
    <path
      d="M16 21v-1.2c0-1.8-1.6-3.3-4-3.3s-4 1.5-4 3.3V21"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M12 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M20 21v-1.1c0-1.3-.8-2.4-2-2.9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M18 6.2a3 3 0 0 1 0 6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-5 w-5"} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M19.4 15a8.4 8.4 0 0 0 .1-6l-2.2.3a6.9 6.9 0 0 0-1.4-1.4l.3-2.2a8.4 8.4 0 0 0-6-.1l.3 2.2a6.9 6.9 0 0 0-1.4 1.4L6 9a8.4 8.4 0 0 0-.1 6l2.2-.3a6.9 6.9 0 0 0 1.4 1.4l-.3 2.2a8.4 8.4 0 0 0 6 .1l-.3-2.2a6.9 6.9 0 0 0 1.4-1.4l2.1.3Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const items: Item[] = [
  { label: "Home", href: "/home", icon: HomeIcon },
  { label: "Gallery", href: "/family-photos", icon: GridIcon },
  { label: "Events", href: "/events", icon: CalendarIcon },
  { label: "Groups", href: "/groups", icon: UsersIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

/** Renders the sticky left sidebar navigation panel. */
export default function SideNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="sticky top-16">
      <div className="rounded-2xl border border-neutral-900 bg-neutral-950/40 p-3">
        <div className="px-2 pt-1 pb-3 text-xs text-neutral-400">
          Navigation
        </div>

        <div className="space-y-1">
          {items.map((it) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + "/");

            const Icon = it.icon;

            return (
              <button
                key={it.href}
                onClick={() => router.push(it.href)}
                className={cls(active)}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate">{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
