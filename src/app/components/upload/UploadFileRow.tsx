"use client";

import React from "react";
import type { UploadFileStatus, UploadStage } from "@/types/upload";

type Props = {
  item: UploadFileStatus;
  onRetry: (fileId: string) => void;
};

const STAGE_LABELS: Record<UploadStage, string> = {
  idle: "Queued",
  preparing: "Preparing…",
  requesting_url: "Requesting upload slot…",
  uploading_preview: "Uploading preview…",
  uploading_original: "Uploading…",
  committing: "Saving…",
  queued_processing: "Queued for processing…",
  processing: "Processing on server…",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

const FAILED_STAGE_LABELS: Partial<Record<UploadStage, string>> = {
  preparing: "Failed while preparing",
  uploading_preview: "Failed while uploading preview",
  uploading_original: "Failed while uploading",
  committing: "Failed while saving",
  queued_processing: "Failed to start processing",
};

/** Returns 0–3 representing which third of the processing ring to fill. */
function processingRingSegment(stage: UploadStage): number {
  if (stage === "done") return 3;
  if (stage === "processing" || stage === "queued_processing") return 2;
  if (
    stage === "requesting_url" ||
    stage === "uploading_preview" ||
    stage === "uploading_original" ||
    stage === "committing"
  )
    return 1;
  return 0;
}

/** Circular SVG progress ring — 3 segments for upload → queued → done. */
function ProcessingRing({ stage }: { stage: UploadStage }) {
  const size = 20;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const segment = processingRingSegment(stage);
  const filled = (segment / 3) * circ;
  const isPulsing = stage === "processing";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={stroke}
      />
      {/* Fill */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgb(163,163,163)"
        strokeWidth={stroke}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        style={{
          transition: "stroke-dasharray 0.4s ease",
          opacity: isPulsing ? undefined : 1,
        }}
        className={isPulsing ? "animate-pulse" : undefined}
      />
    </svg>
  );
}

const UploadFileRow = React.memo(function UploadFileRow({ item, onRetry }: Props) {
  const { fileId, filename, stage, errorStage, errorMessage, retryCount } = item;

  const isFailed = stage === "failed";
  const isDone = stage === "done";
  const isActive = !isFailed && !isDone && stage !== "idle" && stage !== "skipped";

  const label = isFailed
    ? (errorStage ? FAILED_STAGE_LABELS[errorStage] ?? "Failed" : "Failed")
    : STAGE_LABELS[stage];

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-white/5 transition">
      {/* Status indicator */}
      <div className="shrink-0 w-5 h-5 flex items-center justify-center">
        {isDone ? (
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8l3.5 3.5 6.5-7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : isFailed ? (
          <svg className="w-4 h-4 text-red-400" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ) : isActive ? (
          <ProcessingRing stage={stage} />
        ) : (
          <div className="w-4 h-4 rounded-full border border-white/20" />
        )}
      </div>

      {/* Filename + status */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-neutral-200">{filename}</div>
        <div
          className={`text-[11px] tabular-nums ${
            isFailed ? "text-red-400" : "text-neutral-500"
          }`}
        >
          {label}
          {isFailed && errorMessage ? ` — ${errorMessage}` : ""}
          {retryCount > 0 ? ` (retry ${retryCount})` : ""}
        </div>
      </div>

      {/* Retry button */}
      {isFailed ? (
        <button
          onClick={() => onRetry(fileId)}
          className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700 transition"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
});

export default UploadFileRow;
