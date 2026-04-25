/**
 * POST /api/auth/logout
 *
 * Clears the `accessToken`, `idToken`, and `refreshToken` cookies by setting
 * them to an empty value with `maxAge: 0`. The browser will immediately expire
 * them on receipt.
 *
 * Note: this does NOT revoke the tokens in Cognito — they remain valid until
 * their natural expiry. For full revocation, call `AdminUserGlobalSignOut` on
 * the server (a future improvement tracked separately).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/auth/logout", async () => {
  const res = NextResponse.json({ success: true }, { status: 200 });
  const secure = process.env.NODE_ENV === "production";

  const base = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };

  res.cookies.set("accessToken", "", base);
  res.cookies.set("idToken", "", base);
  res.cookies.set("refreshToken", "", base);

  return res;
});
