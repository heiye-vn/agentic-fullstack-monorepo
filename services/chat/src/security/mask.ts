/**
 * services/chat/src/security/mask.ts
 *
 * 密钥脱敏（第十八章 18.16 / 18.16.1）
 *
 * 原则：日志、API 响应、错误信息里**不出现**任何可用凭据。
 * 只记 ID 和形状（18.16.2），不记内容。
 *
 * ⚠️ 本项目特有的一个坑：model_configs.apiKey 列存的可能是
 * **AES-256-GCM 密文**（带 `enc:v1:` 前缀，见第十章模型配置方案 C），
 * 也可能是历史遗留的明文。两者脱敏策略不同 ——
 *   密文：连密文片段都不能给（密文 + 已知算法可离线分析，且会污染日志检索）
 *   明文：保留少量前后缀便于人工核对用的是哪一把 key
 */

/** 密文前缀，与第十章加解密实现保持一致 */
const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * 脱敏单个密钥。
 * - 空值统一返回 '***'（不区分 null / undefined / 空串，避免「有没有配置」被推测）
 * - 密文 → 只留前缀标识
 * - 明文 → 前后各留少量字符，长度不足则整体打码
 */
export function maskSecret(value?: string | null): string {
  if (!value) return '***';

  if (value.startsWith(ENCRYPTED_PREFIX)) {
    return `${ENCRYPTED_PREFIX}***`;
  }

  if (value.length <= 8) return '***';

  // 短 key 少留一点、长 key 多留一点，但后缀最多 4 位
  const head = value.slice(0, 4);
  const tail = value.slice(-4);
  return `${head}***${tail}`;
}

/**
 * 把对象里的 apiKey 字段脱敏后返回副本。
 * 用泛型保持其余字段类型不变，调用方可以直接 `return maskApiKey(config)`。
 */
export function maskApiKey<T extends { apiKey?: string | null }>(record: T): T {
  return { ...record, apiKey: maskSecret(record.apiKey) };
}

/** 批量脱敏（列表接口用） */
export function maskApiKeys<T extends { apiKey?: string | null }>(records: T[]): T[] {
  return records.map(maskApiKey);
}
