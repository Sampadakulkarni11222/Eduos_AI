import { securityHeaders } from './security-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Dev convenience: proxy API to core-api. Production uses an ingress route.
    return [{ source: '/api/v1/:path*', destination: `${process.env.API_URL ?? 'http://localhost:5000'}/api/v1/:path*` }];
  },
  async headers() {
    // Production only: the dev server needs eval and a websocket for hot
    // reload, and a policy written for production would only report noise.
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      { source: '/:path*', headers: securityHeaders({ backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL }) },
      // Browsers must always fetch the newest service worker, or a fix to it
      // would wait out whatever cache lifetime the response carried.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};
export default nextConfig;
