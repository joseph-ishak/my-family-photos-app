import React, { useState } from "react";
import heic2any from "heic2any";
type Props = {
  open: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  existingEvents: string[];
  user: any;
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

  if (!open) return null;

  const isCreatingNew = selectedEvent === "__new__";
  const eventId = isCreatingNew ? newEvent : selectedEvent;

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
  const handleUpload = async () => {
    if (!files.length || !user || !eventId) return;
    setUploading(true);
    try {
      for (const file of files) {
        const normalizedFile = await normalizeImage(file);
        const res = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: normalizedFile.name,
            filetype: normalizedFile.type,
            userId: user.sub,
            eventId,
          }),
        });
        const { signedUrl } = await res.json();
        if (!signedUrl) throw new Error("signedUrl missing");

        const uploadRes = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": normalizedFile.type },
          body: normalizedFile,
        });

        if (!uploadRes.ok) throw new Error("Upload failed");
      }
      setFiles([]);
      setSelectedEvent("");
      setNewEvent("");
      onUploadSuccess();
      onClose();
    } catch (err) {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-white rounded-xl shadow-xl p-8 min-w-[320px] flex flex-col">
        <h2 className="text-xl font-semibold mb-4">Upload Photos</h2>
        <label className="flex flex-col mb-4 font-medium">
          <span>Choose files:</span>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="mt-2"
          />
        </label>
        <label className="flex flex-col mb-4 font-medium">
          <span>Event:</span>
          <select
            className="mt-2 px-3 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
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
            />
          </label>
        )}
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleUpload}
            disabled={
              uploading ||
              !files.length ||
              (!isCreatingNew && !selectedEvent) ||
              (isCreatingNew && !newEvent)
            }
            className="px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
