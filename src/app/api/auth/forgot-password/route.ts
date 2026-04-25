/**
 * POST /api/auth/forgot-password
 *
 * Triggers Cognito's `ForgotPassword` flow, which sends a verification code to
 * the user's registered email address. The code is then used in
 * `POST /api/auth/reset-password` to set a new password.
 *
 * Always returns 200 — even for unknown usernames — to prevent user enumeration.
 * Cognito itself handles that response shape.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  ForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "@/lib/db/client";
import { withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/auth/forgot-password", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({} as any));
  const username =
    typeof body?.username === "string" ? body.username.trim() : "";

  if (!username) {
    return NextResponse.json({ error: "Missing username" }, { status: 400 });
  }

  await cognito.send(
    new ForgotPasswordCommand({
      ClientId: process.env.COGNITO_APP_CLIENT_ID!,
      Username: username,
    })
  );

  return NextResponse.json({ success: true }, { status: 200 });
});
