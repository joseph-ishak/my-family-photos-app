import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { getVerifiedUser } from "@/lib/auth-server";
import { s3 } from "@/lib/db/client";
import { requireBucket, withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/profile/avatar-upload", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename, filetype } = await req.json();

  const safeName = String(filename ?? "avatar")
    .replace(/[^a-zA-Z0-9._]/g, "_")
    .slice(0, 120);

  const key = `avatars/${user.sub}/${uuidv4()}_${safeName}`;

  const bucket = requireBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: filetype,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return NextResponse.json({ signedUrl, s3Key: key });
});
