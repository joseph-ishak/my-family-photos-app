"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";

export default function RequireCompleteProfile({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, isAuthed, profile } = useProfile();

  useEffect(() => {
    if (loading) return;
    if (!isAuthed) return;

    const incomplete = profile?.profileComplete === false;
    const onSettings = pathname.startsWith("/settings");

    if (incomplete && !onSettings) {
      const next = encodeURIComponent(pathname || "/home");
      router.replace(`/settings?setup=1&next=${next}`);
    }
  }, [loading, isAuthed, profile, pathname, router]);

  return children;
}
