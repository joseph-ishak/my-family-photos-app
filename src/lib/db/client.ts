/**
 * Shared singleton AWS SDK clients.
 *
 * Instantiating clients once at module load time and re-using them across
 * route handlers avoids the overhead of creating a new TCP connection and
 * re-fetching JWKS / credentials on every Lambda invocation.
 *
 * All clients pick up credentials automatically from the Lambda execution
 * role via the standard AWS credential provider chain — no explicit key/secret
 * is needed in environment variables at runtime.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const region = process.env.AWS_REGION ?? "us-west-2";

/** DynamoDB document client — marshals JS objects to/from DynamoDB AttributeValues. */
export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region })
);

/** S3 client used for presigned URLs and object operations.
 *  responseChecksumValidation "when_required" prevents the SDK from embedding
 *  x-amz-checksum-mode=ENABLED in presigned GetObject URLs — S3 rejects range
 *  requests (used for video seeking) when that flag is present. */
export const s3 = new S3Client({
  region,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

/** Cognito client used for all auth operations (login, refresh, forgot-password, etc.). */
export const cognito = new CognitoIdentityProviderClient({ region });
