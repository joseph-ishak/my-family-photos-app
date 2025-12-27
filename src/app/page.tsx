"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "../lib/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      const user = await getCurrentUser();
      if (!user) router.replace("/login?redirect=/family-photos");
      else router.replace("/family-photos");
    }
    checkAuth();
  }, [router]);

  return <p>Loading...</p>;
}
