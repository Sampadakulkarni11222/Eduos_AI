import os from 'node:os';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second build can live beside the running one (NEXT_DIST_DIR=.next-verify).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  experimental: {
    // Portal pages are client components that load their own data, so the
    // router may reuse a page it rendered moments ago instead of asking the
    // server again on every back-and-forth between two tabs.
    staleTimes: { dynamic: 30 },
    // "Generating static pages" runs one worker per CPU by default; with 500+
    // routes on a busy machine a worker can die (0xC0000409 / spawn UNKNOWN)
    // and fail the build. Four workers, overridable with NEXT_BUILD_WORKERS,
    // and a retry for a page whose generation fails, keep the build robust.
    cpus: Number(process.env.NEXT_BUILD_WORKERS) || Math.min(4, Math.max(1, os.cpus().length - 1)),
    staticGenerationRetryCount: 3,
  },
  async headers() {
    // Self-hosted font files never change under the same name.
    return [{ source: '/fonts/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }];
  },
  async rewrites() {
    // Dev convenience: proxy API to core-api. Production uses an ingress route.
    return [{ source: '/api/v1/:path*', destination: `${process.env.API_URL ?? 'http://127.0.0.1:5000'}/api/v1/:path*` }];
  },
};
export default nextConfig;
