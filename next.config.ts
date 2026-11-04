import type { NextConfig } from "next";
import path from "path";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  // Standalone only for Docker/prod builds — slows local tooling if always on
  ...(isProd ? { output: 'standalone' as const } : {}),

  compress: true,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  compiler: {
    removeConsole: isProd ? { exclude: ['error', 'warn', 'info'] } : false,
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  outputFileTracingRoot: path.join(__dirname),

  // Prevent secret files, tests, scratch scripts, and developer artifacts from entering standalone builds
  outputFileTracingExcludes: {
    '*': [
      './.env*',
      '**/.env*',
      './tests/**',
      '**/tests/**',
      './scratch/**',
      '**/scratch/**',
      './*.md',
      '**/README.md',
      './debug*',
      '**/debug*',
      './test_*',
      '**/test_*',
      './verify_*',
      '**/verify_*',
      './tsc-errors.txt',
      '**/tsc-errors.txt',
      './package-lock.json',
      '**/node_modules/typescript/**',
      '**/node_modules/@esbuild/**',
    ],
    '**/*': [
      './.env*',
      '**/.env*',
      './tests/**',
      '**/tests/**',
      './scratch/**',
      '**/scratch/**',
      './*.md',
      '**/README.md',
      './debug*',
      '**/debug*',
      './test_*',
      '**/test_*',
      './verify_*',
      '**/verify_*',
      './tsc-errors.txt',
      '**/tsc-errors.txt',
      './package-lock.json',
      '**/node_modules/typescript/**',
      '**/node_modules/@esbuild/**',
    ],
  },

  // Keep heavy native/CJS packages out of the bundler graph → faster compiles
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    'mongodb',
    'exceljs',
    // exceljs transitive deps — must also be external so Turbopack/Vercel
    // can resolve bluebird's internal require('./debuggability') at runtime
    'bluebird',
    'unzipper',
    'pdf-lib',
    'bcryptjs',
    'nodemailer',
    'qrcode',
  ],

  // Ensure Prisma query engines are traced into serverless/standalone output
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/.prisma/**/*',
      './node_modules/@prisma/client/**/*',
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Keep soft-nav RSC payloads briefly → faster page-to-page transitions
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // Tree-shake UI packages (must not overlap serverExternalPackages)
    optimizePackageImports: [
      'zod',
      'uuid',
      'next-auth',
      'lucide-react',
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
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
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
