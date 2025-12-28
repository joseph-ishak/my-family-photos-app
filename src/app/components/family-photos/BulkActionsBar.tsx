"use client";

import { useState } from "react";

type Props = {
  selectedCount: number;
  onDeleteSelected: () => void | Promise<void>;
};

export default function BulkActionsBar({
  selectedCount,
  onDeleteSelected,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (selectedCount === 0) return null;

  async function handleConfirmDelete() {
    if (deleting) return;

    setDeleting(true);

    try {
      await onDeleteSelected();
      setConfirmOpen(false);
    } catch (err) {
      console.error("Delete Selected error", err);
      alert("Delete Selected failed. See console.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();

            console.log("Delete Selected clicked. count =", selectedCount);
            setConfirmOpen(true);
          }}
          className="bg-red-600 text-white px-4 py-2 rounded shadow hover:bg-red-700"
        >
          Delete Selected ({selectedCount})
        </button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl p-6 min-w-[320px] max-w-[520px] w-[92vw]">
            <h3 className="text-lg font-semibold text-gray-900">
              Delete selected photos
            </h3>

            <p className="mt-2 text-sm text-gray-700">
              This will permanently delete {selectedCount} photo
              {selectedCount === 1 ? "" : "s"}.
            </p>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
                className="px-5 py-2 rounded bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-5 py-2 rounded bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
