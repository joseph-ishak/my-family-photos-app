"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });

        const data = await res.json().catch(() => null);
        const user = data?.user ?? null;

        if (cancelled) return;

        router.replace(user ? "/home" : "/login");
      } catch {
        if (!cancelled) router.replace("/login");
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-[60vh] grid place-items-center">
      <p className="text-sm text-neutral-500">Loading…</p>
    </div>
  );
}
