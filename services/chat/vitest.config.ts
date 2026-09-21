import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    // 第十六章：pino 默认输出 JSON 到 stdout，测试里没必要刷屏（断言都走指标与 sink）。
    // 需要看结构化日志时把这里删掉或改成 'debug' 即可。
    env: {
      LOG_LEVEL: 'silent',
    },
  },
});
