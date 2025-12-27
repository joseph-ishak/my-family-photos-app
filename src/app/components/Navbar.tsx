"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <nav className="bg-blue-600 text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo / Brand */}
          <div
            className="flex-shrink-0 text-2xl font-bold cursor-pointer"
            onClick={() => router.push("/home")}
          >
            Family Photos
          </div>

          {/* Desktop Links */}
          <div className="hidden md:flex space-x-6 items-center">
            <button
              onClick={() => router.push("/home")}
              className="hover:text-gray-200"
            >
              Home
            </button>
            <button
              onClick={() => router.push("/family-photos")}
              className="hover:text-gray-200"
            >
              Gallery
            </button>
            <button onClick={handleLogout} className="hover:text-gray-200">
              Logout
            </button>
          </div>

          {/* Mobile Hamburger */}
          <div className="md:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="focus:outline-none"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                {isOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-blue-600 px-4 pt-2 pb-4 space-y-2">
          <button
            onClick={() => {
              router.push("/");
              setIsOpen(false);
            }}
            className="block w-full text-left hover:text-gray-200"
          >
            Home
          </button>
          <button
            onClick={() => {
              router.push("/family-photos");
              setIsOpen(false);
            }}
            className="block w-full text-left hover:text-gray-200"
          >
            Gallery
          </button>
          <button
            onClick={handleLogout}
            className="block w-full text-left hover:text-gray-200"
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
