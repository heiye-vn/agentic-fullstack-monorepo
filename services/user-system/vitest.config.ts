import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      // 第十九章：AuthService.register 有一道 ENABLE_PUBLIC_REGISTRATION 开关，
      // 默认关闭——这是安全上的正确默认，运行时不应该动它。
      // 但 auth.spec.ts 的用例 1 要覆盖真实注册链路（含密码哈希），开关关着会在
      // register 处就抛 ForbiddenException，并让后续 5 个用例连锁失败。
      // 这里只在测试进程内打开，与运行时配置解耦。
      ENABLE_PUBLIC_REGISTRATION: 'true',
      // JWT_SECRET：AuthService 内部走 getJwtSecret()，该函数在第 18 章被加固成
      // 「缺失即抛错、且长度必须 ≥ 32」，绝不接受硬编码兜底值（否则可伪造任意用户令牌）。
      // vitest 不会自动加载 .env，所以这里显式注入一个明确标注为测试专用的值。
      // 生产密钥仍然只能来自运行时环境变量，这条配置不削弱任何运行时安全保证。
      JWT_SECRET: 'autix_test_only_jwt_secret_do_not_use_in_production',
    },
  },
});
