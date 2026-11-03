import { defineConfig } from '@playwright/test';
import { fromRoot } from "./root";
const baseURL = process.env.PHONEOPS_BASE_URL ?? 'http://localhost:3100';
const production = new URL(baseURL).hostname === 'vppsone.vercel.app';
const evidenceStem = production ? 'deployed-phone-routes' : 'dev-phone-routes';

export default defineConfig({
  testDir: fromRoot('./tests/e2e'),
  testMatch: 'phone-operations-readonly.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['json', { outputFile: fromRoot(`../evidence/${evidenceStem}.json`) }]],
  outputDir: fromRoot(`../evidence/${evidenceStem}`),
  // QA auth confirmation contains a one-time token; keep it out of traces.
  use: { baseURL, trace: 'off', screenshot: production ? 'off' : 'only-on-failure' },
});
