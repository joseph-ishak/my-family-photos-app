"use client";

type Props = {
  onUploadClick: () => void;
};

export default function GalleryHeader({ onUploadClick }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-center text-gray-800">
        Family Photo Gallery
      </h1>

      <button
        onClick={onUploadClick}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg shadow transition duration-150 mx-auto block"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        Upload Photo
      </button>
    </div>
  );
}
