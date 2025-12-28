"use client";

type Props = {
  existingEvents: string[];
  eventFilter: string;
  dateFilter: string;
  onEventChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onClear: () => void;
};

export default function FiltersBar({
  existingEvents,
  eventFilter,
  dateFilter,
  onEventChange,
  onDateChange,
  onClear,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
      <select
        value={eventFilter}
        onChange={(e) => onEventChange(e.target.value)}
        className="border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All events</option>
        {existingEvents.map((ev) => (
          <option key={ev} value={ev}>
            {ev}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={dateFilter}
        onChange={(e) => onDateChange(e.target.value)}
        className="border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <button
        onClick={onClear}
        className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 transition"
      >
        Clear Filters
      </button>
    </div>
  );
}
