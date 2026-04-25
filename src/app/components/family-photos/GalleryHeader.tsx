"use client";

/**
 * Page header for the gallery view. Displays the "Gallery" heading, a
 * sub-title, and an "Upload" button that opens the upload modal.
 */

type Props = {
  /** Called when the user clicks the Upload button. */
  onUploadClick: () => void;
};

/** Inline SVG plus icon for the upload button. */
const PlusIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Renders the gallery page heading and the primary "Upload" action button.
 */
export default function GalleryHeader({ onUploadClick }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Gallery
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Upload and organize moments by event.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onUploadClick}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition"
        >
          <PlusIcon />
          Upload
        </button>
      </div>
    </div>
  );
}
