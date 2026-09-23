import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置（第二十章 Layer 3：浏览器级满血链路回归）
 *
 * 这一层**默认不跑**：spec 里用 `test.skip(!RUN_BROWSER_E2E)` 拦了一道，
 * 必须显式 `RUN_BROWSER_E2E=1` 才会真正执行。原因有三：
 *   1. 要真浏览器 + 真服务（user-system / chat / chat-web 全在跑）
 *   2. 要真 LLM 调用，会花钱，一条短任务实测几分钟
 *   3. 它守的是「整条链路能不能通」，属于 release gate，不该进每次 PR
 *
 * 所以超时也给得很宽（整测 12 分钟），代价换的是「不因为慢而假失败」。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 720_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    // chat-web 的默认端口是 3002（见 infra/compose/compose.yaml）
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:3002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
