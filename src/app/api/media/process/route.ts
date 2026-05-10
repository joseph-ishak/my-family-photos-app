import type { NextRequest } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { getVerifiedUser } from "@/lib/auth-server";
import { apiError, apiOk, withErrorHandler } from "@/lib/api";
interface ProcessHeicEvent {
  mediaId: string;
  sk: string;
  incomingKey: string;
  eventId: string;
  userId: string;
  takenAt: string;
  filename: string;
}

const lambda = new LambdaClient({ region: process.env.S3_REGION ?? "us-west-2" });

/**
 * POST /api/media/process
 *
 * Asynchronously invokes the ProcessHeic Lambda for a raw HEIC file that has
 * already been PUT to S3 under `incoming/photos/`.  The Lambda converts the
 * file to a display JPEG and preview thumbnail, archives the original HEIC
 * under `originals/`, and writes the DynamoDB record.
 *
 * The client polls GET /api/media/status until the DynamoDB record appears.
 */
export const POST = withErrorHandler("POST /api/media/process", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) return apiError("Unauthorized", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { mediaId, sk, incomingKey, eventId, takenAt, filename } = body as Partial<ProcessHeicEvent>;

  if (!mediaId || !sk || !incomingKey || !eventId || !takenAt || !filename) {
    return apiError("Missing required fields", 400);
  }

  const functionName = process.env.PROCESS_HEIC_FUNCTION_NAME;
  if (!functionName) return apiError("HEIC processing not configured", 500);

  const payload: ProcessHeicEvent = {
    mediaId,
    sk,
    incomingKey,
    eventId,
    userId: user.sub,
    takenAt,
    filename,
  };

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  return apiOk({ queued: true });
});
