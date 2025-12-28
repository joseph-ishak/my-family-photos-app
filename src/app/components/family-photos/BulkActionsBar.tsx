"use client";

type Props = {
  selectedCount: number;
  onDeleteSelected: () => void;
};

export default function BulkActionsBar({
  selectedCount,
  onDeleteSelected,
}: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex justify-end">
      <button
        onClick={onDeleteSelected}
        className="bg-red-600 text-white px-4 py-2 rounded shadow hover:bg-red-700"
      >
        Delete Selected ({selectedCount})
      </button>
    </div>
  );
}
