"use client";

/**
 * Persistent floating upload status tray.
 *
 * Visible in all authenticated pages while uploads are active or completed.
 * Collapsed: a small pill (bottom-right) showing a count badge and spinner.
 * Expanded: a drawer panel listing every file with its stage and retry option.
 *
 * Positioned above the mobile BottomNav (bottom-20 on sm, bottom-4 on lg).
 */

import React from "react";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import UploadFileRow from "./UploadFileRow";
import type { UploadFileStatus } from "@/types/upload";

function overallSummary(queue: UploadFileStatus[]) {
  const total = queue.length;
  const done = queue.filter((f) => f.stage === "done").length;
  const failed = queue.filter((f) => f.stage === "failed").length;
  const active = queue.filter(
    (f) => f.stage !== "done" && f.stage !== "failed" && f.stage !== "skipped"
  ).length;
  return { total, done, failed, active };
}

export default function UploadTray() {
  const { queue, isVisible, isPanelOpen, retryFile, dismissCompleted, togglePanel } =
    useUploadQueue();

  if (!isVisible || queue.length === 0) return null;

  const { total, done, failed, active } = overallSummary(queue);
  const allDone = active === 0 && failed === 0;
  const hasFailures = failed > 0;

  return (
    <div className="fixed bottom-20 right-4 z-50 lg:bottom-4 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {isPanelOpen && (
        <div className="w-80 max-h-96 rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl flex flex-col overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-800">
            <div className="text-sm font-semibold text-neutral-100">
              {allDone
                ? "Uploads complete"
                : hasFailures && active === 0
                ? "Uploads finished with errors"
                : `Uploading ${done}/${total}`}
            </div>
            <div className="flex items-center gap-2">
              {allDone && (
                <button
                  onClick={dismissCompleted}
                  className="text-[11px] text-neutral-500 hover:text-neutral-300 transition"
                >
                  Clear
                </button>
              )}
              <button
                onClick={togglePanel}
                className="text-neutral-500 hover:text-neutral-300 transition"
                aria-label="Collapse"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 10l4-4 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {!allDone && (
            <div className="h-1 bg-neutral-800">
              <div
                className="h-full bg-neutral-400 transition-[width] duration-300 ease-out"
                style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
              />
            </div>
          )}

          {/* File list */}
          <div className="overflow-y-auto flex-1 py-1">
            {queue.map((item) => (
              <UploadFileRow key={item.fileId} item={item} onRetry={retryFile} />
            ))}
          </div>
        </div>
      )}

      {/* Collapsed pill */}
      <button
        onClick={togglePanel}
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg border transition ${
          hasFailures && !active
            ? "bg-red-950 border-red-800 text-red-200 hover:bg-red-900"
            : allDone
            ? "bg-neutral-900 border-neutral-700 text-neutral-200 hover:bg-neutral-800"
            : "bg-neutral-900 border-neutral-700 text-neutral-200 hover:bg-neutral-800"
        }`}
        aria-label={isPanelOpen ? "Collapse upload tray" : "Expand upload tray"}
      >
        {/* Icon */}
        {allDone && !hasFailures ? (
          <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8l3.5 3.5 6.5-7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : hasFailures && !active ? (
          <svg className="w-3.5 h-3.5 text-red-400 shrink-0" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 5v4M8 11v1"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M7 2.27L1.27 12A1 1 0 002.13 13.5h11.74a1 1 0 00.86-1.5L9 2.27a1 1 0 00-2 0z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg
            className="w-3.5 h-3.5 text-neutral-400 shrink-0 animate-spin"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M8 2a6 6 0 100 12A6 6 0 008 2z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="20 10"
            />
          </svg>
        )}

        {/* Label */}
        <span>
          {allDone && !hasFailures
            ? `${done} uploaded`
            : hasFailures && !active
            ? `${failed} failed`
            : `${done}/${total} uploading`}
        </span>

        {/* Chevron */}
        <svg
          className={`w-3 h-3 text-neutral-500 shrink-0 transition-transform ${isPanelOpen ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
