"use client";

import { useParams } from "next/navigation";
import FamilyPhotosPage from "@/app/family-photos/page";

export default function EventDetailPage() {
  const params = useParams();
  const eventId = typeof params?.eventId === "string" ? params.eventId : "";

  return <FamilyPhotosPage initialEventFilter={eventId} />;
}
