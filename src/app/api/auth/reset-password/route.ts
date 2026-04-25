/**
 * POST /api/auth/reset-password
 *
 * Completes the forgot-password flow initiated by `POST /api/auth/forgot-password`.
 * Calls Cognito's `ConfirmForgotPassword` with the verification code that was
 * emailed to the user and the new password they have chosen.
 *
 * Request body:
 *   { username: string; code: string; newPassword: string }
 *
 * Responses:
 *   200 — password changed successfully.
 *   400 — missing required fields.
 *   4xx/5xx — propagated from Cognito (e.g. expired code, invalid password policy).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  ConfirmForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "@/lib/db/client";
import { withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/auth/reset-password", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const username =
    typeof body?.username === "string" ? body.username.trim() : "";

  const codeRaw = body?.code ?? body?.resetCode ?? body?.confirmationCode ?? body?.ConfirmationCode;
  const code = typeof codeRaw === "string" ? codeRaw.trim() : "";

  // Accept only the canonical field name. Older clients sending "password" or
  // "Password" will get a clear validation error pointing them to "newPassword".
  const newPasswordRaw = body?.newPassword;
  const newPassword = typeof newPasswordRaw === "string" ? newPasswordRaw : "";

  if (!username || !code || !newPassword) {
    return NextResponse.json(
      { error: "Missing required fields: username, code, newPassword" },
      { status: 400 }
    );
  }

  await cognito.send(
    new ConfirmForgotPasswordCommand({
      ClientId: process.env.COGNITO_APP_CLIENT_ID!,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    })
  );

  return NextResponse.json({ success: true }, { status: 200 });
});
