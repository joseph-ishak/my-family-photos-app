"use client";

/**
 * Generic modal backdrop and portal wrapper.
 *
 * Renders children inside a `document.body` portal so z-index stacking is
 * not affected by the component's position in the React tree. Adds:
 *   - A semi-transparent black overlay that calls `onClose` on click.
 *   - An Escape key listener that also calls `onClose`.
 *   - `overflow: hidden` on `document.body` to prevent background scrolling.
 *
 * The portal is only created after the component mounts (`mounted` state) to
 * avoid SSR hydration mismatches.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Wraps `children` in a full-screen modal overlay rendered into
 * `document.body`. Handles Escape key, backdrop click, and body scroll-lock.
 */
export default function ModalShell({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div className="relative h-full w-full grid place-items-center p-4">
        {children}
      </div>
    </div>,
    document.body
  );
}
