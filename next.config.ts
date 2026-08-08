import type { NextConfig } from "next";
import path from "path";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  // Standalone only for Docker/prod builds — slows local tooling if always on
  ...(isProd ? { output: 'standalone' as const } : {}),

  compress: true,
  productionBrowserSourceMaps: false,
  // Strict mode double-invokes effects in dev (feels slower) — keep for prod quality locally is optional
  reactStrictMode: true,

  typescript: {
    ignoreBuildErrors: false,
  },

  // Keep heavy native/CJS packages out of the bundler graph → faster compiles
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    'mongodb',
    'exceljs',
    'pdf-lib',
    'xlsx',
    'bcryptjs',
    'nodemailer',
    'qrcode',
  ],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    optimizePackageImports: [
      'zod',
      'uuid',
      'lucide-react',
      'framer-motion',
    ],
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/**',
      }
    ],
    minimumCacheTTL: 3600,
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
              "connect-src 'self' https://*.upstash.io https://*.neon.tech",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
      {
        source: '/editor/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-src 'self' ${process.env.ONLYOFFICE_SERVER_URL || 'http://localhost:8080'}; script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${process.env.ONLYOFFICE_SERVER_URL || 'http://localhost:8080'}`,
          },
        ],
      },
      ...(isProd
        ? [
            {
              source: '/fonts/(.*)',
              headers: [
                { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
              ],
            },
          ]
        : []),
      {
        source: '/robots.txt',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ];
  },

  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
