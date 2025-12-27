"use client";

export default function TailwindTestPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-6">
      <div className="bg-red-500 text-white text-4xl p-8">
        TAILWIND SANITY CHECK
      </div>
      <h1 className="text-4xl font-bold text-blue-600 mb-6">
        Tailwind is Working!
      </h1>
      <button className="px-6 py-3 bg-green-500 text-white rounded-lg shadow-lg hover:bg-green-600 transition">
        Click Me
      </button>
      <p className="mt-4 text-gray-700">
        If you see these styles, Tailwind is active.
      </p>
    </div>
  );
}
