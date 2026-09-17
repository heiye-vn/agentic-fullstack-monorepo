import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * 模型配置密钥的落库加解密（AES-256-GCM）
 *
 * 背景：ModelConfig 表带 apiKey 字段，但直接明文存库风险很高
 * （任何有库读权限的人、任何 SELECT * 的日志、任何备份文件都会泄露密钥）。
 * 因此这里统一加密后入库，运行时再解密使用。
 *
 * 兼容策略：加密结果带 `enc:v1:` 前缀。读取时——
 *   - 有前缀   → 走解密流程
 *   - 无前缀   → 视为历史遗留明文，原样返回（保证老数据不炸）
 * 解密失败一律返回空串并打日志，**绝不把密文当 API Key 发出去**。
 */

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const logger = new Logger('SecretCrypto');

/** 从环境变量派生 32 字节密钥 */
function deriveKey(): Buffer {
  const raw =
    process.env.MODEL_CONFIG_SECRET || process.env.JWT_SECRET || '';
  if (!raw) {
    throw new Error(
      '缺少 MODEL_CONFIG_SECRET（或 JWT_SECRET），无法加解密模型密钥',
    );
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** 是否已是加密形态 */
export function isEncrypted(value?: string | null): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** 加密；空值或已加密的幂等返回 */
export function encryptSecret(plain?: string | null): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain;

  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** 解密；无前缀按明文原样返回；失败返回空串 */
export function decryptSecret(stored?: string | null): string {
  if (!stored) return '';
  if (!isEncrypted(stored)) {
    // 历史明文数据：原样返回，避免升级后老配置突然失效
    return stored;
  }

  try {
    const key = deriveKey();
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');

    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch (err) {
    // 常见原因：换过 MODEL_CONFIG_SECRET、数据被截断或损坏
    logger.warn(
      `模型密钥解密失败（请检查 MODEL_CONFIG_SECRET 是否变更）: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return '';
  }
}
