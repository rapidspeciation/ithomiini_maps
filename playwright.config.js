import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  // Each worker runs Chromium with software WebGL (about 0.5-1 GB). The default of half the cores
  // (6 on a 12-core PC) ran out of memory locally; CI's 4-core runner already gets 2.
  workers: process.env.CI ? undefined : 2,
  use: {
    baseURL: 'http://127.0.0.1:5175/ithomiini_maps/',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --host 0.0.0.0 --port 5175',
    port: 5175,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: { viewport: { width: 375, height: 812 }, isMobile: true },
    },
  ],
})
