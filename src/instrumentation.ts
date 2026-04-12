export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fetch secrets from AWS Secrets Manager at cold start and inject into
    // process.env so all existing code (cursor.ts, Sentry, etc.) works unchanged.
    const { loadSecrets } = await import("./lib/secrets");
    const secrets = await loadSecrets();
    process.env.CURSOR_SECRET = secrets.CURSOR_SECRET;
    process.env.SENTRY_DSN    = secrets.SENTRY_DSN;

    // Init Sentry after secrets are available so it picks up the DSN
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime can't call Secrets Manager — Sentry DSN is not available
    // in middleware, which is acceptable (middleware errors still hit CloudWatch).
    await import("../sentry.edge.config");
  }
}
