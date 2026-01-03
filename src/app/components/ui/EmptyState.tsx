"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;

  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;

  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryDisabled?: boolean;

  className?: string;
};

export default function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  actionDisabled,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryDisabled,
  className,
}: Props) {
  return (
    <div
      className={
        "rounded-2xl border border-white/10 bg-neutral-950/40 p-6 sm:p-8 " +
        (className ?? "")
      }
    >
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        {icon ? (
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-neutral-950/60 text-white/80">
            {icon}
          </div>
        ) : null}

        <div className="text-base font-semibold text-white/90">{title}</div>

        {description ? (
          <div className="mt-2 text-sm leading-relaxed text-white/60">
            {description}
          </div>
        ) : null}

        {(actionLabel && onAction) ||
        (secondaryActionLabel && onSecondaryAction) ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {actionLabel && onAction ? (
              <button
                type="button"
                onClick={onAction}
                disabled={actionDisabled}
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {actionLabel}
              </button>
            ) : null}

            {secondaryActionLabel && onSecondaryAction ? (
              <button
                type="button"
                onClick={onSecondaryAction}
                disabled={secondaryDisabled}
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-neutral-950/40 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-neutral-900/40 disabled:opacity-50"
              >
                {secondaryActionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyStateIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 10.5 10 7.5l2.5 2.5L16 6.5 20 10.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7.5l3-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 14.5a3.5 3.5 0 0 0 7 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
