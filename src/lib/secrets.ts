import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

type AppSecrets = {
  CURSOR_SECRET: string;
  SENTRY_DSN: string;
};

let cached: AppSecrets | null = null;

/**
 * Fetches app secrets from AWS Secrets Manager and caches them in memory.
 * On warm Lambda invocations the cached value is returned instantly —
 * no network call is made after the first cold-start fetch.
 *
 * In local development (no SECRETS_ARN set) falls back to env vars so
 * `npm run dev` works without AWS credentials.
 */
export async function loadSecrets(): Promise<AppSecrets> {
  if (cached) return cached;

  const arn = process.env.SECRETS_ARN;

  // Local dev fallback — use env vars directly
  if (!arn) {
    cached = {
      CURSOR_SECRET: process.env.CURSOR_SECRET ?? "",
      SENTRY_DSN:    process.env.SENTRY_DSN    ?? "",
    };
    return cached;
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "us-west-2",
  });

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: arn })
  );

  if (!response.SecretString) {
    throw new Error("Secret value is empty");
  }

  cached = JSON.parse(response.SecretString) as AppSecrets;
  return cached;
}
