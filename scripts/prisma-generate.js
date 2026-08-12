#!/usr/bin/env node
/**
 * Ensure Prisma Client is generated on Vercel (cached node_modules skip auto-generate).
 * Placeholder DB URLs are only for `prisma generate` — runtime uses real env vars.
 */
const { spawnSync } = require('child_process');

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://prisma:prisma@127.0.0.1:5432/prisma_build?schema=public';
}
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const result = spawnSync('npx', ['prisma', 'generate'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

process.exit(result.status === null ? 1 : result.status);
