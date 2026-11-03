import { defineConfig } from '@playwright/test';
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot('./tests/class-followup'), testMatch: 'phone.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45_000, expect: { timeout: 8000 },
  reporter: [['list'], ['json', { outputFile: fromRoot('../evidence/class-followup-phone.json') }]],
  outputDir: fromRoot('../evidence/class-followup-phone'),
  use: { baseURL: 'http://127.0.0.1:3211', isMobile: true, hasTouch: true, serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'phone-360', use: { viewport: { width: 360, height: 800 } } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'phone-412', use: { viewport: { width: 412, height: 915 } } },
    { name: 'phone-landscape', use: { viewport: { width: 844, height: 390 } } },
  ],
  webServer: process.env.PHONEOPS_CLASS_STATIC_DIR ? undefined : { cwd: ROOT, command: 'npx vite --config tests/class-followup/vite.config.ts', url: 'http://127.0.0.1:3211', timeout: 180_000, reuseExistingServer: false },
});
