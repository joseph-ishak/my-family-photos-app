/**
 * Lambda function: submit-mediaconvert
 *
 * Replaces process-video.ts. Instead of running FFmpeg inside Lambda, this
 * function creates an AWS MediaConvert job and returns immediately (~1 s).
 * MediaConvert transcodes in parallel, producing:
 *
 *   1. H.264 MP4 with FastStart → uploads/videos/{mediaId}.mp4
 *      Serves as the presigned-URL fallback for non-HLS clients.
 *
 *   2. HLS adaptive bitrate → previews/hls/{mediaId}/index.m3u8
 *      Two renditions: 720p @ 2.5 Mbps, 1080p @ 5 Mbps.
 *      Stored under previews/ so the existing CloudFront CDN serves it
 *      without auth (CDN rewrites /hls/... → /previews/hls/...).
 *
 * Completion is handled by mediaconvert-complete.ts via an EventBridge rule.
 * All context needed by the completion Lambda is packed into UserMetadata.
 *
 * Required env vars:
 *   S3_BUCKET_NAME          — uploads bucket name
 *   MEDIACONVERT_ENDPOINT   — regional endpoint, e.g. https://mediaconvert.us-west-2.amazonaws.com
 *   MEDIACONVERT_ROLE_ARN   — IAM role with s3:GetObject + s3:PutObject on the bucket
 */

import {
  MediaConvertClient,
  CreateJobCommand,
  type CreateJobCommandInput,
} from "@aws-sdk/client-mediaconvert";

const REGION   = process.env.AWS_REGION ?? "us-west-2";
const BUCKET   = process.env.S3_BUCKET_NAME!;
const ENDPOINT = process.env.MEDIACONVERT_ENDPOINT!;
const ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN!;

// MediaConvert requires the account-specific endpoint, not the regional one.
const mc = new MediaConvertClient({ region: REGION, endpoint: ENDPOINT });

export interface SubmitMediaConvertEvent {
  mediaId: string;
  sk: string;
  incomingKey: string;
  eventId: string;
  userId: string;
  takenAt: string;
  filename: string;
}

export const handler = async (event: SubmitMediaConvertEvent): Promise<{ jobId: string }> => {
  const { mediaId, sk, incomingKey, eventId, userId, takenAt, filename } = event;

  const log = (step: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ step, mediaId, incomingKey, ...extra }));

  log("start", { eventId, sk, takenAt, filename });

  if (!ENDPOINT || !ROLE_ARN) {
    throw new Error(
      "MEDIACONVERT_ENDPOINT and MEDIACONVERT_ROLE_ARN must be set"
    );
  }

  // Output destinations:
  //   MP4  → uploads/videos/{mediaId}.mp4   (presigned-URL served, fallback)
  //   HLS  → previews/hls/{mediaId}/        (CDN served, primary playback)
  const mp4Destination = `s3://${BUCKET}/uploads/videos/${mediaId}`;
  const hlsDestination = `s3://${BUCKET}/previews/hls/${mediaId}/`;

  const input: CreateJobCommandInput = {
    Role: ROLE_ARN,
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${BUCKET}/${incomingKey}`,
          AudioSelectors: {
            "Audio Selector 1": { DefaultSelection: "DEFAULT" },
          },
          VideoSelector: {},
          TimecodeSource: "ZEROBASED",
        },
      ],
      OutputGroups: [
        // ── Output Group 1: MP4 (FastStart, single rendition) ────────────────
        {
          Name: "MP4",
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              // Destination is the full key prefix without extension —
              // MediaConvert appends ".mp4" automatically.
              Destination: mp4Destination,
            },
          },
          Outputs: [
            {
              ContainerSettings: {
                Container: "MP4",
                Mp4Settings: {
                  // PROGRESSIVE_DOWNLOAD = moov atom at front (equivalent to
                  // FFmpeg's -movflags faststart). Enables play before full download.
                  MoovPlacement: "PROGRESSIVE_DOWNLOAD",
                },
              },
              VideoDescription: {
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    // MaxBitrate is required on H264Settings when RateControlMode is QVBR.
                    // MULTI_PASS_HQ is required when MaxBitrate is set with QVBR.
                    MaxBitrate: 8_000_000, // 8 Mbps ceiling for 1080p MP4
                    QualityTuningLevel: "MULTI_PASS_HQ",
                    QvbrSettings: {
                      QvbrQualityLevel: 7,
                    },
                    SceneChangeDetect: "TRANSITION_DETECTION",
                    CodecLevel: "AUTO",
                    CodecProfile: "HIGH",
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: {
                      Bitrate: 96000,
                      CodingMode: "CODING_MODE_2_0",
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },

        // ── Output Group 2: HLS adaptive bitrate (720p + 1080p) ─────────────
        {
          Name: "HLS",
          OutputGroupSettings: {
            Type: "HLS_GROUP_SETTINGS",
            HlsGroupSettings: {
              Destination: hlsDestination,
              // 6-second segments: good balance between start latency and seek speed.
              SegmentLength: 6,
              MinSegmentLength: 0,
              ManifestDurationFormat: "INTEGER",
              DirectoryStructure: "SINGLE_DIRECTORY",
              SegmentControl: "SEGMENTED_FILES",
              // Master manifest name (without extension) — results in index.m3u8
              // MediaConvert names it after the first output, so we set NameModifier
              // on all outputs consistently (handled below via NameModifier).
            },
          },
          Outputs: [
            // ── 720p rendition ───────────────────────────────────────────────
            {
              NameModifier: "_720p",
              ContainerSettings: {
                Container: "M3U8",
                M3u8Settings: {},
              },
              VideoDescription: {
                Height: 720,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    MaxBitrate: 2_500_000,
                    QualityTuningLevel: "MULTI_PASS_HQ",
                    QvbrSettings: {
                      QvbrQualityLevel: 7,
                    },
                    SceneChangeDetect: "TRANSITION_DETECTION",
                    CodecLevel: "AUTO",
                    CodecProfile: "MAIN",
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: {
                      Bitrate: 96000,
                      CodingMode: "CODING_MODE_2_0",
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
            // ── 1080p rendition ──────────────────────────────────────────────
            {
              NameModifier: "_1080p",
              ContainerSettings: {
                Container: "M3U8",
                M3u8Settings: {},
              },
              VideoDescription: {
                Height: 1080,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    MaxBitrate: 5_000_000,
                    QualityTuningLevel: "MULTI_PASS_HQ",
                    QvbrSettings: {
                      QvbrQualityLevel: 7,
                    },
                    SceneChangeDetect: "TRANSITION_DETECTION",
                    CodecLevel: "AUTO",
                    CodecProfile: "HIGH",
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: "CODING_MODE_2_0",
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },

    // Context passed through to the completion Lambda via EventBridge.
    // MediaConvert echoes UserMetadata unchanged in the job state change event.
    UserMetadata: {
      mediaId,
      sk,
      eventId,
      userId,
      takenAt,
      filename,
      incomingKey,
      bucket: BUCKET,
    },
  };

  const result = await mc.send(new CreateJobCommand(input));
  const jobId = result.Job?.Id ?? "unknown";
  log("job-created", { jobId });
  return { jobId };
};
