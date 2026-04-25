/**
 * @file Manual smoke-test script for S3 connectivity.
 *
 * Uploads a tiny `test.txt` object to the configured S3 bucket to verify
 * that the AWS credentials and bucket policy are working correctly.
 *
 * Run with:
 * ```
 * npx tsx src/script/test-s3.ts
 * ```
 *
 * Required environment variables:
 * - `S3_REGION`          — AWS region of the target bucket.
 * - `AWS_ACCESS_KEY_ID`  — IAM access key ID.
 * - `AWS_SECRET_ACCESS_KEY` — IAM secret access key.
 * - `S3_BUCKET`          — Bucket name to write into.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/** S3 client configured from environment variables. */
const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/**
 * Attempts to PUT a `test.txt` file into the configured S3 bucket.
 * Logs success or the error to stdout/stderr.
 */
async function test() {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: "test.txt",
        Body: "hello world",
      })
    );
    console.log("Upload succeeded");
  } catch (e) {
    console.error(e);
  }
}

test();
