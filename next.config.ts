import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopack: false, // fallback to Webpack
  },
};

export default nextConfig;
