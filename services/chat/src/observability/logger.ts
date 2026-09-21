/**
 * logger.ts
 *
 * 基于 pino 的结构化日志单例。
 * - 默认输出 JSON（每行一条，可直接被 Loki/ELK/Datadog 摄取）
 * - 设 LOG_PRETTY=1 时用 pino-pretty 彩色美化（仅本地开发用，生产不要开：会多起一个 worker 线程）
 * - 每条日志自动带上当前请求的 traceId（从 ALS 读，见 trace-context.ts）
 * - 敏感字段统一脱敏（密钥/token/密码一律不进日志）
 */
import pino from 'pino';
import { getTraceId } from './trace-context.js';

const isDev = process.env.NODE_ENV !== 'production';
const usePretty = process.env.LOG_PRETTY === '1';

/** pino mixin：每次打日志时从 ALS 读当前 traceId 注入。导出以便单测验证机制。 */
export function traceMixin(): { traceId: string } {
  return { traceId: getTraceId() };
}

const base = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: usePretty
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
    : undefined,
  // mixin 在每次打日志时调用，因此 traceId 永远是「当前」请求的
  mixin: traceMixin,
  // 注意只脱敏真正的凭据字段：不要写成 'token'，否则会把 token 计数一起抹掉
  redact: {
    paths: [
      'apiKey',
      '*.apiKey',
      'authorization',
      '*.authorization',
      'headers.authorization',
      'password',
      '*.password',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
    ],
    censor: '***',
  },
});

/** 给某个模块创建带固定字段的子 logger，例如 createLogger('orchestrator')。 */
export function createLogger(module: string) {
  return base.child({ module });
}

/** 根 logger（需要直接打日志时使用）。 */
export const log = base;
