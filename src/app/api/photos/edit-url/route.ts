// src/app/api/photos/edit-url/route.ts
import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Adjust this import to your actual auth helper
import { getVerifiedUser } from "../../../../lib/auth-server";

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function POST(req: Request) {
  try {
    const user = await getVerifiedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      eventId?: string;
      photoKey?: string;
      mimeType?: string;
    };

    if (!body.photoKey) {
      return NextResponse.json({ error: "Missing photoKey" }, { status: 400 });
    }

    const bucket = process.env.PHOTOS_BUCKET;
    if (!bucket) {
      return NextResponse.json(
        { error: "Missing PHOTOS_BUCKET" },
        { status: 500 }
      );
    }

    const mimeType = body.mimeType || "image/jpeg";

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: body.photoKey,
      ContentType: mimeType,
      Metadata: {
        edited: "true",
      },
    });

    const signedPutUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });

    return NextResponse.json({ signedPutUrl });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to create edit url" },
      { status: 500 }
    );
  }
}
