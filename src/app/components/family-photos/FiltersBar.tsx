"use client";

/**
 * Filter bar for the family photos gallery.
 *
 * Provides three filtering controls side-by-side:
 * - **Event** — `<select>` populated from `existingEvents`.
 * - **Date** — `<input type="date">` for filtering by upload date.
 * - **Media type** — segmented button (All / Photos / Videos).
 *
 * A **Clear filters** button is enabled only when at least one filter is active.
 * All state is owned by the parent (`usePhotoFeed`); this component is purely
 * presentational and fires callbacks on every change.
 */

/** Discriminated union for the media-type segment control. */
type MediaFilter = "all" | "photo" | "video";

/** Props accepted by `FiltersBar`. */
type Props = {
  /** Sorted list of event IDs to populate the event dropdown. */
  existingEvents: string[];
  /** Currently active event filter value, or `""` for no filter. */
  eventFilter: string;
  /** Currently active date filter (ISO `YYYY-MM-DD`), or `""` for no filter. */
  dateFilter: string;
  /** Currently active media type filter. */
  mediaFilter: MediaFilter;
  /** Called when the event dropdown selection changes. */
  onEventChange: (value: string) => void;
  /** Called when the date input value changes. */
  onDateChange: (value: string) => void;
  /** Called when the media type segment selection changes. */
  onMediaChange: (value: MediaFilter) => void;
  /** Called when the Clear filters button is clicked. */
  onClear: () => void;
};

/** ✕ icon used inside the Clear filters button. */
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

/** Options for the media-type segment control, in display order. */
const MEDIA_OPTIONS: { label: string; value: MediaFilter }[] = [
  { label: "All",    value: "all"   },
  { label: "Photos", value: "photo" },
  { label: "Videos", value: "video" },
];

/**
 * Filter toolbar rendered above the photo grid.
 * All three filters (event, date, media type) are controlled externally.
 */
export default function FiltersBar({
  existingEvents,
  eventFilter,
  dateFilter,
  mediaFilter,
  onEventChange,
  onDateChange,
  onMediaChange,
  onClear,
}: Props) {
  const hasFilters = Boolean(eventFilter || dateFilter || mediaFilter !== "all");

  return (
    <div className="rounded-2xl border border-neutral-900 bg-neutral-950/40 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs text-neutral-400 sm:hidden">Event</label>
            <select
              value={eventFilter}
              onChange={(e) => onEventChange(e.target.value)}
              className="h-11 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            >
              <option value="">All events</option>
              {existingEvents.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs text-neutral-400 sm:hidden">Date</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-11 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>

          {/* Media type segment control */}
          <div className="flex items-center rounded-xl border border-neutral-800 bg-neutral-950/40 p-1 gap-0.5">
            {MEDIA_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onMediaChange(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  mediaFilter === opt.value
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onClear}
          disabled={!hasFilters}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm hover:bg-neutral-900 transition disabled:opacity-40"
        >
          <XIcon />
          Clear filters
        </button>
      </div>
    </div>
  );
}
