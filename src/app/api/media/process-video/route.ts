import type { NextRequest } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { getVerifiedUser } from "@/lib/auth-server";
import { apiError, apiOk, withErrorHandler } from "@/lib/api";

interface SubmitMediaConvertEvent {
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
 * POST /api/media/process-video
 *
 * Asynchronously invokes the SubmitMediaConvert Lambda for a raw video file
 * already PUT to S3 under `incoming/videos/`. The Lambda creates an AWS
 * MediaConvert job (H.264 MP4 + HLS adaptive bitrate) and returns immediately.
 *
 * Completion is handled by the MediaConvertComplete Lambda triggered via
 * EventBridge. The client polls POST /api/media/status until
 * processingStatus === "ready".
 */
export const POST = withErrorHandler("POST /api/media/process-video", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) return apiError("Unauthorized", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { mediaId, sk, incomingKey, eventId, takenAt, filename } =
    body as Partial<SubmitMediaConvertEvent>;

  if (!mediaId || !sk || !incomingKey || !eventId || !takenAt || !filename) {
    return apiError("Missing required fields", 400);
  }

  const functionName = process.env.SUBMIT_MEDIACONVERT_FUNCTION_NAME;
  if (!functionName) return apiError("Video processing not configured", 500);

  const payload: SubmitMediaConvertEvent = {
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
      InvocationType: "Event", // fire-and-forget
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  return apiOk({ queued: true });
});
