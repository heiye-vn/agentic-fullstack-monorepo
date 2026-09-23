import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { config as loadDotEnv } from 'dotenv';

// vitest 只把 .env 里 VITE_ 前缀的变量暴露出去，DATABASE_URL 这类普通变量
// **不会**自动进 process.env。第十九章把 PrismaService 的硬编码兜底去掉之后，
// 依赖真实数据库的集成用例（prisma.spec / conversation.spec）本地就再也拿不到
// 连接串了 —— CI 里是显式注入的所以不受影响，本地却会莫名其妙地失败。
// 这里显式加载一次：dotenv 不覆盖已存在的环境变量，CI 的注入依然优先。
loadDotEnv();

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
