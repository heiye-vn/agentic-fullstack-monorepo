/**
 * JWT 密钥统一获取（fail-fast）
 *
 * 安全要求：密钥缺失时必须在启动阶段直接抛错终止进程，
 * 绝不允许回退到硬编码的默认值 —— 否则任何知道源码的人
 * 都可以伪造任意用户（包括超级管理员）的合法令牌。
 */
let cachedSecret: string | null = null;

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      '[FATAL] 环境变量 JWT_SECRET 未配置。请在 services/user-system/.env 中设置强随机密钥（建议 openssl rand -hex 32 生成），服务拒绝以不安全的默认密钥启动。',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      '[FATAL] JWT_SECRET 长度不足 32 字符，存在被暴力破解风险。请使用 openssl rand -hex 32 生成。',
    );
  }

  cachedSecret = secret;
  return secret;
}

/**
 * 解析形如 "15m" / "30s" / "12h" / "7d" / "900" 的过期时间配置为秒数
 */
export function parseExpiresInSeconds(input: string | undefined, fallback: number): number {
  if (!input) return fallback;

  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(input.trim());
  if (!match) return fallback;

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;

  return value * multiplier;
}
