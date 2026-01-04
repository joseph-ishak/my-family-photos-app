// src/app/(app)/settings/page.tsx
import { Suspense } from "react";
import SettingsClientPage from "./SettingsClientPage";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] grid place-items-center">
          <p className="text-sm text-neutral-500">Loading…</p>
        </div>
      }
    >
      <SettingsClientPage />
    </Suspense>
  );
}
