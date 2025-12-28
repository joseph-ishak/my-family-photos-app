import React, { useState } from "react";
import heic2any from "heic2any";

type Props = {
  open: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  existingEvents: string[];
  user: any;
};

type Job = {
  index: number;
  file: File;
};

export default function PhotoUploadModal({
  open,
  onClose,
  onUploadSuccess,
  existingEvents,
  user,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [newEvent, setNewEvent] = useState<string>("");

  const [uploading, setUploading] = useState(false);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>("");

  const isCreatingNew = selectedEvent === "__new__";
  const eventId = (isCreatingNew ? newEvent : selectedEvent).trim();

  const overallProgress = files.length
    ? Math.max(
        0,
        Math.min(100, Math.round((completedCount / files.length) * 100))
      )
    : 0;

  if (!open) return null;

  async function normalizeImage(file: File): Promise<File> {
    if (
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic")
    ) {
      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });

      return new File(
        [convertedBlob as Blob],
        file.name.replace(/\.heic$/i, ".jpg"),
        { type: "image/jpeg" }
      );
    }

    return file;
  }

  async function uploadOneFile(
    file: File,
    eventIdValue: string,
    userId: string
  ) {
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        filetype: file.type,
        userId,
        eventId: eventIdValue,
      }),
    });

    if (!res.ok) {
      throw new Error(`upload url failed: ${res.status}`);
    }

    const { signedUrl } = await res.json();
    if (!signedUrl) throw new Error("signedUrl missing");

    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error(`upload failed: ${uploadRes.status}`);
    }
  }

  async function runWithConcurrency(
    jobs: Job[],
    concurrency: number,
    worker: (job: Job) => Promise<void>
  ) {
    let next = 0;
    let firstError: unknown = null;

    async function runner() {
      while (true) {
        if (firstError) return;

        const job = jobs[next];
        if (!job) return;

        next += 1;

        try {
          await worker(job);
        } catch (err) {
          firstError = err;
          return;
        }
      }
    }

    const runners = Array.from({ length: Math.max(1, concurrency) }, () =>
      runner()
    );

    await Promise.all(runners);

    if (firstError) {
      throw firstError;
    }
  }

  const handleUpload = async () => {
    if (!files.length || !user || !eventId) return;

    setUploading(true);
    setCompletedCount(0);
    setActiveCount(0);
    setStatusText("Preparing files");

    try {
      const normalizedFiles: File[] = [];
      for (const f of files) {
        const nf = await normalizeImage(f);
        normalizedFiles.push(nf);
      }

      const jobs: Job[] = normalizedFiles.map((file, index) => ({
        file,
        index,
      }));

      setStatusText("Uploading");

      await runWithConcurrency(jobs, 3, async (job) => {
        setActiveCount((c) => c + 1);
        setStatusText(
          `Uploading ${Math.min(completedCount + 1, files.length)} of ${
            files.length
          }`
        );

        try {
          await uploadOneFile(job.file, eventId, user.sub);
          setCompletedCount((c) => c + 1);
        } finally {
          setActiveCount((c) => Math.max(0, c - 1));
        }
      });

      setStatusText("Finishing");

      setFiles([]);
      setSelectedEvent("");
      setNewEvent("");

      onUploadSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    } finally {
      setUploading(false);
      setStatusText("");
      setCompletedCount(0);
      setActiveCount(0);
    }
  };

  const uploadDisabled =
    uploading ||
    !files.length ||
    !user ||
    !eventId ||
    (isCreatingNew && !newEvent.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-white rounded-2xl shadow-xl p-8 min-w-[360px] max-w-[560px] w-[92vw] flex flex-col">
        <h2 className="text-xl font-semibold mb-4">Upload Photos</h2>

        <label className="flex flex-col mb-4 font-medium">
          <span>Choose files:</span>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="mt-2"
            disabled={uploading}
          />
        </label>

        <label className="flex flex-col mb-4 font-medium">
          <span>Event:</span>
          <select
            className="mt-2 px-3 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
            disabled={uploading}
          >
            <option value="">Select event</option>
            {existingEvents.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
            <option value="__new__">Create new event…</option>
          </select>
        </label>

        {isCreatingNew && (
          <label className="flex flex-col mb-4 font-medium">
            <span>New event name:</span>
            <input
              type="text"
              placeholder="Enter new event name"
              value={newEvent}
              onChange={(e) => setNewEvent(e.target.value)}
              className="mt-2 px-3 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
              disabled={uploading}
            />
          </label>
        )}

        {uploading && (
          <div className="mb-5 rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">
                  Uploading photos
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {files.length
                    ? `Completed ${Math.min(completedCount, files.length)} of ${
                        files.length
                      }`
                    : "Uploading"}
                  {activeCount ? ` • ${activeCount} active` : ""}
                  {statusText ? ` • ${statusText}` : ""}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-2xl font-semibold text-gray-900 tabular-nums">
                  {overallProgress}%
                </div>
                <div className="text-[11px] text-gray-500 tabular-nums">
                  {overallProgress < 100 ? "In progress" : "Done"}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 transition-[width] duration-300 ease-out"
                  style={{ width: `${overallProgress}%` }}
                />
                <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.9),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.75),transparent_50%)]" />
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                <span className="truncate">
                  {files.length ? `${files.length} total files` : ""}
                </span>
                <span className="tabular-nums">
                  {files.length
                    ? `${Math.min(completedCount, files.length)}/${
                        files.length
                      } completed`
                    : ""}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <button
            onClick={handleUpload}
            disabled={uploadDisabled}
            className="px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>

          <button
            onClick={onClose}
            disabled={uploading}
            className="px-5 py-2 rounded bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        {!uploading && files.length > 0 && (
          <div className="mt-3 text-xs text-gray-500">
            {files.length} file{files.length === 1 ? "" : "s"} selected
          </div>
        )}
      </div>
    </div>
  );
}
