"use client";

type MediaFilter = "all" | "photo" | "video";

type Props = {
  existingEvents: string[];
  eventFilter: string;
  dateFilter: string;
  mediaFilter: MediaFilter;
  onEventChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onMediaChange: (value: MediaFilter) => void;
  onClear: () => void;
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

const MEDIA_OPTIONS: { label: string; value: MediaFilter }[] = [
  { label: "All",    value: "all"   },
  { label: "Photos", value: "photo" },
  { label: "Videos", value: "video" },
];

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
