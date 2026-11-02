#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/**
 * P5-01 Standalone Build Secret Purge
 * Ensures no .env files, scratch scripts, tests, or persistent storage roots
 * enter production standalone artifacts.
 */
const standaloneDir = path.join(process.cwd(), '.next', 'standalone');

if (fs.existsSync(standaloneDir)) {
  const sensitiveFiles = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.development',
    '.env.development.local',
    '.env.test',
    '.env.test.local',
    'tsc-errors.txt',
    'debug.ts',
    'debug.js',
    'debug_parse.ts',
    'test_excel.js',
    'verify_excel_pipeline.js',
    'README.md',
  ];

  for (const file of sensitiveFiles) {
    const fullPath = path.join(standaloneDir, file);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`[clean-standalone] Purged sensitive build artifact: ${file}`);
    }
  }

  const sensitiveDirs = [
    'tests',
    'scratch',
    'storage-vault',
    'secure-storage',
    '.secure-storage',
  ];

  for (const dir of sensitiveDirs) {
    const fullPath = path.join(standaloneDir, dir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`[clean-standalone] Purged sensitive build directory: ${dir}`);
    }
  }
}

