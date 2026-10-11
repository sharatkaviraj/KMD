import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'phone-operations-readonly.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['json', { outputFile: '../evidence/dev-phone-routes.json' }]],
  outputDir: '../evidence/dev-phone-routes',
  // QA auth confirmation contains a one-time token; keep it out of traces.
  use: { baseURL: process.env.PHONEOPS_BASE_URL ?? 'http://localhost:3100', trace: 'off', screenshot: 'only-on-failure' },
});
