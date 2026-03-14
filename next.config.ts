import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',

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
  experimental: {
    serverActions: {
      bodySizeLimit: '150mb',
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
        ],
      },
      // NO CACHE for dynamic/secure routes
      {
        source: '/signup/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/share/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/view/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/revoke/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      // AGGRESSIVE CACHE for static assets (1 year, immutable)
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
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
