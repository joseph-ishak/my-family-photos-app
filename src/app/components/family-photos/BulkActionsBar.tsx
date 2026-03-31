"use client";

import { useMemo, useState } from "react";
import ModalShell from "@/app/components/ui/ModalShell";

type Props = {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void | Promise<void>;
};

const XIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M6 6l12 12M18 6 6 18"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const CheckAllIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M4 12l4 4L20 4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 20h16"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      opacity="0.6"
    />
  </svg>
);

const TrashIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M9 3h6m-8 4h10m-9 0 1 14h6l1-14M10 7v12m4-12v12"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function BulkActionsBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const allSelected = useMemo(() => {
    return totalCount > 0 && selectedCount === totalCount;
  }, [totalCount, selectedCount]);

  const showBar = totalCount > 0 && selectedCount > 0;

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
      <div
        className={
          showBar ? "sticky top-14 z-30 -mx-3 sm:-mx-4 lg:-mx-6" : "hidden"
        }
      >
        <div className="mx-auto w-full max-w-[1800px] px-3 sm:px-4 lg:px-6">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/85 backdrop-blur shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {selectedCount} selected
                    {totalCount ? (
                      <span className="text-neutral-400"> of {totalCount}</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    Tap items to select more.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClearSelection();
                  }}
                  className="sm:hidden h-9 w-9 rounded-xl border border-neutral-800 bg-neutral-900/40 grid place-items-center hover:bg-neutral-900 transition"
                  aria-label="Clear selection"
                  title="Clear selection"
                >
                  <XIcon />
                </button>
              </div>

              <div className="flex items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (allSelected) onClearSelection();
                    else onSelectAll();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm hover:bg-neutral-900 transition"
                >
                  <CheckAllIcon />
                  {allSelected ? "Clear" : "Select all"}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 transition"
                >
                  <TrashIcon />
                  Delete
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClearSelection();
                  }}
                  className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 transition"
                >
                  <XIcon />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ModalShell
        open={confirmOpen}
        onClose={deleting ? () => {} : () => setConfirmOpen(false)}
      >
        <div className="w-full max-w-[520px] rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-xl text-neutral-100">
          <h3 className="text-lg font-semibold">Delete selected photos</h3>

          <p className="mt-2 text-sm text-neutral-300">
            This will permanently delete {selectedCount} photo
            {selectedCount === 1 ? "" : "s"}. This action cannot be undone.
          </p>

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
              className="rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting || selectedCount === 0}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </ModalShell>
    </>
  );
}
