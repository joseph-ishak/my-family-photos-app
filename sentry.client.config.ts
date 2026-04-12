import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of sessions for performance tracing — plenty for a family app
  tracesSampleRate: 0.1,

  // Only show Sentry debug output in development
  debug: false,
});
