import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3101;
const WEB_PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    colorScheme: 'light',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  },
  expect: {
    toHaveScreenshot: {
      // 动画禁用 + 隐藏光标；小比例容差吸收字体渲染的亚像素抖动。
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.005,
    },
  },
  // 按平台分目录：Windows 本地基线与 Linux CI 字体渲染不同，各自持有。
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{testName}/{arg}{ext}',
  outputDir: './e2e/test-results',
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // 用 Chromium 模拟移动视口（iPhone 设备描述符默认 WebKit，需另装浏览器）。
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'node e2e/start-web.mjs',
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
