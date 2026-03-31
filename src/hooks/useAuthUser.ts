"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AuthState = {
  loading: boolean;
  user: any | null;
};

export function useAuthUser(): AuthState {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        if (!data.user) {
          router.replace("/login");
          return;
        }

        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return { loading, user };
}
