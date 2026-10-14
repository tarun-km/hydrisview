import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  transpilePackages: ['@hydris/domain'],
  poweredByHeader: false,
  async rewrites() {
    // The browser only talks to this origin; /api is proxied to the Hydris API.
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      { source: '/((?!glasses|simulator).*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
      { source: '/(glasses|simulator)(.*)', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
    ];
  },
};

export default nextConfig;
