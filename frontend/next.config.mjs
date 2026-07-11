/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Dev convenience: proxy API to core-api. Production uses an ingress route.
    return [{ source: '/api/v1/:path*', destination: `${process.env.API_URL ?? 'http://localhost:5000'}/api/v1/:path*` }];
  },
};
export default nextConfig;
