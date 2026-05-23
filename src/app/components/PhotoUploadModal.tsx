"use client";

/**
 * Upload modal — file selection and event picker only.
 *
 * All upload logic (thumbnail generation, S3 PUTs, Lambda invocation, polling)
 * now lives in UploadQueueProvider. This modal just collects the user's file
 * and event choices, hands them to the queue, and closes immediately so the
 * user can continue using the app while uploads run in the background.
 */

import React, { useState } from "react";
import { isSupportedFile } from "./upload/UploadQueueProvider";
import { useUploadQueue } from "@/hooks/useUploadQueue";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Still accepted for backwards compat; ignored — queue fires window events instead. */
  onUploadSuccess?: () => void;
  existingEvents: string[];
  user: any;
  lockedEventId?: string;
};

export default function PhotoUploadModal({
  open,
  onClose,
  existingEvents,
  user,
  lockedEventId,
}: Props) {
  const { enqueueFiles } = useUploadQueue();

  const [files, setFiles] = useState<File[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [newEvent, setNewEvent] = useState<string>("");

  const locked = (lockedEventId || "").trim();
  const effectiveSelectedEvent = locked || selectedEvent;
  const isCreatingNew = effectiveSelectedEvent === "__new__";
  const eventId = (isCreatingNew ? newEvent : effectiveSelectedEvent).trim();

  const canSubmit =
    !!user &&
    files.length > 0 &&
    !!eventId &&
    (!isCreatingNew || !!newEvent.trim());

  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    const supported = picked.filter(isSupportedFile);
    setFiles(supported);
    if (picked.length !== supported.length) {
      alert("Some files were skipped because they are not supported.");
    }
  }

  function handleSubmit() {
    if (!canSubmit) return;
    enqueueFiles(files, eventId, user.sub);
    // Reset local state and close immediately — uploads run in the background.
    setFiles([]);
    setSelectedEvent("");
    setNewEvent("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="w-[94vw] max-w-2xl overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold tracking-tight">Upload</div>
              <div className="mt-1 text-sm text-neutral-400">
                Add photos and videos to your library.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900 transition"
            >
              Close
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium text-neutral-200">Choose files</div>
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={handleFileChange}
              className="block w-full text-sm text-neutral-200 file:mr-4 file:rounded-xl file:border-0 file:bg-neutral-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-neutral-900 hover:file:opacity-90"
            />
            {files.length > 0 ? (
              <div className="text-xs text-neutral-400">
                {files.length} file{files.length === 1 ? "" : "s"} selected
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-neutral-200">Event</div>
            <select
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              value={effectiveSelectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              disabled={Boolean(locked)}
            >
              <option value="">Select event</option>
              {existingEvents.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
              <option value="__new__">Create new event</option>
            </select>

            {locked ? (
              <div className="text-xs text-neutral-400">Uploading into this event.</div>
            ) : null}

            {!locked && isCreatingNew ? (
              <input
                type="text"
                placeholder="New event name"
                value={newEvent}
                onChange={(e) => setNewEvent(e.target.value)}
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-2xl bg-neutral-50 px-6 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
            >
              Upload
            </button>
            <button
              onClick={onClose}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-6 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
