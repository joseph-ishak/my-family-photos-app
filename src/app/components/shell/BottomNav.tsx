"use client";
import React from "react";
import { usePathname, useRouter } from "next/navigation";

type Item = {
  label: string;
  href: string;
  icon: (props: { className?: string }) => React.ReactNode;
};

const HomeIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-6 w-6"} viewBox="0 0 24 24" fill="none">
    <path
      d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const GridIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-6 w-6"} viewBox="0 0 24 24" fill="none">
    <path
      d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const CalendarIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-6 w-6"} viewBox="0 0 24 24" fill="none">
    <path
      d="M7 3v3m10-3v3M4.5 9h15M6 6h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg className={className || "h-6 w-6"} viewBox="0 0 24 24" fill="none">
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
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-neutral-900 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto w-full max-w-[1800px] px-3">
        <div className="h-16 grid grid-cols-4">
          {items.map((it) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + "/");
            const Icon = it.icon;

            return (
              <button
                key={it.href}
                onClick={() => router.push(it.href)}
                className={
                  active
                    ? "flex flex-col items-center justify-center gap-1 text-neutral-50"
                    : "flex flex-col items-center justify-center gap-1 text-neutral-400 hover:text-neutral-50 transition"
                }
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-6 w-6" />
                <span className="text-[11px]">{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
