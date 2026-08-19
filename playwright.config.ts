import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4185',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4185 --strictPort',
    port: 4185,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop-chromium', grepInvert: /移动端/, use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', grep: /移动端/, use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
})
