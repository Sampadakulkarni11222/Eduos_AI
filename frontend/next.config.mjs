/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second build can live beside the running one (NEXT_DIST_DIR=.next-verify).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  async rewrites() {
    // Dev convenience: proxy API to core-api. Production uses an ingress route.
    return [{ source: '/api/v1/:path*', destination: `${process.env.API_URL ?? 'http://127.0.0.1:5000'}/api/v1/:path*` }];
  },
};
export default nextConfig;
