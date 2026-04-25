/**
 * Lightweight layout wrapper that constrains content width based on context.
 *
 * - `"media"` (default) — full width; suitable for photo grids and media feeds.
 * - `"readable"` — max-width 3xl (`48rem`); suitable for text-heavy pages.
 */
import type { ReactNode } from "react";

/**
 * Wraps `children` in the appropriate width container for the given `mode`.
 */
export default function ContentFrame({
  children,
  mode = "media",
}: {
  children: ReactNode;
  mode?: "media" | "readable";
}) {
  if (mode === "readable") {
    return <div className="mx-auto w-full max-w-3xl">{children}</div>;
  }

  return <div className="w-full">{children}</div>;
}
