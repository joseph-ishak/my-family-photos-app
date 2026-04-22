import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrubber";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of sessions for performance tracing — plenty for a family app
  tracesSampleRate: 0.1,

  // Only show Sentry debug output in development
  debug: false,

  beforeSend(event) {
    return scrubEvent(event);
  },
});
