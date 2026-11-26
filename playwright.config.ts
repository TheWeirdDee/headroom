import { defineConfig, devices } from '@playwright/test';

// UI end-to-end tests against the real server with the deterministic fake model (test/e2e/server.ts).
// The web app must be built first (npm run build:web); npm run test:e2e does that.
const port = 4319;
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: 'npx tsx test/e2e/server.ts',
    env: { E2E_PORT: String(port) },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
