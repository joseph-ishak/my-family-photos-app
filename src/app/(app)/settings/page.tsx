// src/app/(app)/settings/page.tsx

/**
 * Settings page server component.
 *
 * Wraps `SettingsClientPage` in a `<Suspense>` boundary so that the
 * client component's `useSearchParams()` call doesn't break the SSR build.
 * The fallback spinner is shown while the client bundle hydrates.
 */

import { Suspense } from "react";
import SettingsClientPage from "./SettingsClientPage";

/** Server entry-point for the settings route. */
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
