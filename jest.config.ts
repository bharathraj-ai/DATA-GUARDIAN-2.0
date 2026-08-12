import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // uuid@13 ships ESM-only — allow ts-jest to transform it
  transformIgnorePatterns: ['/node_modules/(?!(uuid)/)'],
  clearMocks: true,
};

export default config;
