import type { NextConfig } from 'next';
import { resolve } from 'node:path';

/**
 * API modes:
 * - External API (API_URL set, or `next dev`, which defaults to the local API on :4000):
 *   /api/* is proxied there with a beforeFiles rewrite, so the in-app route handlers are bypassed.
 * - Built-in API (API_URL unset in a production build, e.g. Vercel): the route handlers under
 *   src/app/api serve the Fastify API in-process (see apps/api/src/serverless.ts).
 */
const API_URL = process.env.API_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:4000' : '');

const nextConfig: NextConfig = {
  transpilePackages: ['@hydris/domain', '@hydris/contracts', '@hydris/api'],
  // Native / wasm / runtime-plugin packages are loaded from node_modules instead of bundled.
  serverExternalPackages: [
    '@node-rs/argon2', 'pg', '@electric-sql/pglite', 'fastify', '@fastify/cookie', '@fastify/helmet', '@fastify/jwt',
    '@fastify/multipart', '@fastify/rate-limit', '@vercel/blob',
  ],
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  // Ship the SQL migrations with the API functions (migrate-on-cold-start).
  outputFileTracingIncludes: { '/api/**/*': ['../api/drizzle/**/*'] },
  poweredByHeader: false,
  async rewrites() {
    if (!API_URL) return [];
    // The browser only talks to this origin; /api is proxied to the Hydris API.
    return { beforeFiles: [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }], afterFiles: [], fallback: [] };
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
