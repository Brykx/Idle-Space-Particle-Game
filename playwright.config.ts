import { defineConfig, devices } from '@playwright/test';

/**
 * One smoke test, in a real browser. The economy is covered properly by Vitest; what needs a
 * browser is the wiring — that the canvas starts, mass climbs, a purchase lands, and a reload
 * gets your progress back.
 *
 * `CHROMIUM_PATH` lets a sandbox with a pre-installed browser skip `playwright install`.
 */
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          // CI runners have no GPU; Pixi falls back to a software rasteriser.
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
