// src/components/ui/EmptyState.tsx
"use client";

import type { ReactNode } from "react";

export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center">
      <div className="text-lg font-semibold">{title}</div>
      {description ? (
        <div className="mt-2 text-sm text-neutral-300">{description}</div>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
