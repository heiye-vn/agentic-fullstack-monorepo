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

/** 完全打码的占位符：对外响应一律用它，不透露任何一位 */
export const REDACTED = '***';

/** 是否配置了密钥（只回答"有没有"，不回答"是什么"） */
export function hasSecret(value?: string | null): boolean {
  return !!value;
}

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

/**
 * **对外响应**用的脱敏：完全打码 + `hasApiKey` 标记。
 *
 * 与 `maskApiKey()` 的区别（两条不同的口径，别混用）：
 *   - `maskApiKey`  走 `maskSecret`，明文会保留前后各 4 位，用于**日志/排障**，
 *     让人能核对"用的是哪一把 key"
 *   - `redactApiKey` 一点都不留，用于 **HTTP 响应 / 前端展示**
 *
 * 模型配置管理页属于后者：密钥一旦落到浏览器，就脱离了服务端控制。
 * 前端只需要知道"配没配"（决定显示"已配置"还是"去配置"）。
 */
export function redactApiKey<T extends { apiKey?: string | null }>(
  record: T,
): T & { apiKey: string | null; hasApiKey: boolean } {
  return {
    ...record,
    apiKey: record.apiKey ? REDACTED : null,
    hasApiKey: hasSecret(record.apiKey),
  };
}

/** 批量版本（列表接口用） */
export function redactApiKeys<T extends { apiKey?: string | null }>(
  records: T[],
): (T & { apiKey: string | null; hasApiKey: boolean })[] {
  return records.map(redactApiKey);
}
