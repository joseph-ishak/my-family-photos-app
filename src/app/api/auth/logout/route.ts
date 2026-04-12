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
