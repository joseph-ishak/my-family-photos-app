import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth-server";
import { withErrorHandler } from "@/lib/api";

export const GET = withErrorHandler("GET /api/auth/me", async (req) => {
  const user = await getVerifiedUser(req);
  return NextResponse.json({ user: user ?? null }, { status: 200 });
});
