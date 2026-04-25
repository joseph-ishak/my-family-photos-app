/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user's Cognito JWT payload, or
 * `{ user: null }` if the session is absent or the token has expired.
 * Always responds with HTTP 200 so the client can check `data.user` rather
 * than handling a 401.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth-server";
import { withErrorHandler } from "@/lib/api";

export const GET = withErrorHandler("GET /api/auth/me", async (req) => {
  const user = await getVerifiedUser(req);
  return NextResponse.json({ user: user ?? null }, { status: 200 });
});
