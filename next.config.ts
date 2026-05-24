import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: 'standalone', // Uncomment this ONLY for Docker/Linux deployments. Turbopack on Windows throws EINVAL due to 'node:crypto' chunk renaming.

  // Enable GZIP/Brotli compression
  compress: true,

  // No source maps in production (smaller bundle)
  productionBrowserSourceMaps: false,

  // React strict mode for development
  reactStrictMode: true,

  // Performance: Skip type checking during build (use CI for that)
  typescript: {
    ignoreBuildErrors: false,
  },

  // Experimental features
  // ONLYOFFICE JWT uses Node.js crypto — must be external
  serverExternalPackages: [],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Tree-shake these packages for faster cold starts
    optimizePackageImports: [
      'zod',
      'bcryptjs',
      'uuid',
      '@prisma/client',
      'qrcode',
      'next-auth',
      'exceljs',
    ],
  },

  // Optimized image handling
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
    minimumCacheTTL: 3600, // 1 hour (was 60s — too aggressive)
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Security headers + aggressive caching for static assets
  async headers() {
    return [
      // Global security headers
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
              "connect-src 'self' https://*.upstash.io https://*.neon.tech",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      // ONLYOFFICE editor — CSP allowing ONLYOFFICE iframe
      {
        source: '/editor/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-src 'self' ${process.env.ONLYOFFICE_SERVER_URL || 'http://localhost:8080'}; script-src 'self' 'unsafe-inline' 'unsafe-eval' ${process.env.ONLYOFFICE_SERVER_URL || 'http://localhost:8080'}`,
          },
        ],
      },
      // AGGRESSIVE CACHE for fonts (1 year, immutable) - ONLY IN PRODUCTION
      ...(process.env.NODE_ENV === 'production'
        ? [
            {
              source: '/fonts/(.*)',
              headers: [
                { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
              ],
            },
          ]
        : []),
      // Cache robots.txt and favicon
      {
        source: '/robots.txt',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
    ];
  },

  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
    root: __dirname,
  },

  // Webpack optimizations (fallback for non-Turbopack builds)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          minSize: 20000,
          maxSize: 244000,
          cacheGroups: {
            default: false,
            vendors: false,
            // Shared code between pages
            commons: {
              name: 'commons',
              chunks: 'all',
              minChunks: 2,
            },
            // Separate vendor chunks for better caching
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendor',
              chunks: 'all',
              priority: 10,
            },
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;
