import type { NextConfig } from "next";

// Security headers applied to every response.
// CSP is kept permissive for Next.js compatibility (inline scripts/styles are
// required by the framework). Tighten further once a nonce-based approach is
// implemented via middleware.
const securityHeaders = [
  // Prevent browsers from MIME-sniffing the content type
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Deny framing entirely — we have no embeddable widget use-case
  { key: "X-Frame-Options", value: "DENY" },

  // Only send the origin (no path/query) when navigating cross-origin
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // HSTS: 1 year, include subdomains, preload-eligible
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },

  // Disable browser features this app does not use
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },

  // Basic CSP — allows Next.js inline behaviour while blocking most injection.
  // 'unsafe-inline' on scripts is required until a nonce strategy is in place.
  // img-src allows blob: (local previews) and data: (HEIC thumbnail stubs).
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs inline scripts; tighten with nonces later
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Photos come from S3 (signed URL host) and the previews CDN
      "img-src 'self' blob: data: https:",
      // Videos have same origins as images
      "media-src 'self' blob: https:",
      // Sentry, Cognito, and S3 uploads
      "connect-src 'self' https:",
      "font-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {},

  typescript: {
    // Type errors in AWS SDK @smithy nested packages cause spurious build failures
    // that don't affect runtime correctness. Type safety is enforced via tsc --noEmit
    // in CI instead.
    ignoreBuildErrors: true,
  },

  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
