// src/app/(app)/layout.tsx
import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
