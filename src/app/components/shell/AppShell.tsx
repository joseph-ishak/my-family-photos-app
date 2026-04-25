"use client";

/**
 * Root authenticated layout shell.
 *
 * Renders the `TopBar`, a two-column grid (sidebar nav + main content) on
 * large screens, and the `BottomNav` tab bar on mobile. The sidebar is hidden
 * on small screens via `hidden lg:block`.
 *
 * All authenticated pages are wrapped in this component via
 * `src/app/(app)/layout.tsx`.
 */

import type { ReactNode } from "react";
import TopBar from "./TopBar";
import SideNav from "./SideNav";
import BottomNav from "./BottomNav";

/**
 * Provides the top bar, responsive side-nav, and bottom-nav shell around
 * authenticated page content.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopBar />

      <div className="mx-auto w-full max-w-[1800px] px-3 sm:px-4 lg:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 lg:gap-6">
          <aside className="hidden lg:block">
            <SideNav />
          </aside>

          <main className="pb-20 lg:pb-8">{children}</main>
        </div>
      </div>

      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
