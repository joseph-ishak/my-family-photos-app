import { NextRequest, NextResponse } from "next/server";
import {
  ConfirmForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "@/lib/db/client";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));

  console.log("reset password raw body", body);

  const username =
    typeof body?.username === "string" ? body.username.trim() : "";

  const codeRaw =
    body?.code ??
    body?.resetCode ??
    body?.confirmationCode ??
    body?.ConfirmationCode;
  const code = typeof codeRaw === "string" ? codeRaw.trim() : "";

  const newPasswordRaw = body?.newPassword ?? body?.password ?? body?.Password;
  const newPassword = typeof newPasswordRaw === "string" ? newPasswordRaw : "";

  if (!username || !code || !newPassword) {
    return NextResponse.json(
      {
        error: "Missing username, code, or newPassword",
        received: {
          username,
          codePresent: Boolean(code),
          newPasswordPresent: Boolean(newPassword),
          keys: body && typeof body === "object" ? Object.keys(body) : [],
        },
      },
      { status: 400 }
    );
  }

  try {
    await cognito.send(
      new ConfirmForgotPasswordCommand({
        ClientId: process.env.COGNITO_APP_CLIENT_ID!,
        Username: username,
        ConfirmationCode: code,
        Password: newPassword,
      })
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("Cognito reset password error:", err);
    return NextResponse.json(
      { error: err?.name || err?.message || "Reset password failed" },
      { status: 400 }
    );
  }
}
