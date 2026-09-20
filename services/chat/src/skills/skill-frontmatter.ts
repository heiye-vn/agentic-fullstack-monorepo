/**
 * src/skills/skill-frontmatter.ts
 *
 * 第十三章 13.3.1 — SKILL.md 的 frontmatter 解析与校验
 *
 * 只依赖 js-yaml（项目已有），不引入 gray-matter：这里要的是"能读 + 能校验"，
 * 而不是一个通用 frontmatter 库。校验失败要给出可定位的错误，
 * 因为 SKILL.md 是给人写的资产，写错了必须当场报出来，不能静默降级。
 */
import { load as loadYaml } from 'js-yaml';
import type { SkillFrontmatter } from './skill-types.js';

/**
 * Skill 名的安全字符集
 *
 * 这是 13.10.1 安全边界的第一道闸：skillName 会被拼进文件路径，
 * 只允许 kebab-case，从根本上杜绝 `../../` 这类穿越写法。
 */
export const SAFE_SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 规范建议 description ≤ 1024 字符 */
export const MAX_DESCRIPTION_LENGTH = 1024;

const FRONTMATTER_RE = /^\uFEFF?[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

export interface FrontmatterParseResult {
  ok: boolean;
  errors: string[];
  frontmatter?: SkillFrontmatter;
  /** 去掉 frontmatter 后的正文；解析失败时为原文 */
  body: string;
}

function toToolList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value)
    ? value
    : String(value)
        .split(',')
        .map((s) => s.trim());
  return Array.from(
    new Set(raw.map((s) => String(s).trim()).filter(Boolean)),
  );
}

/**
 * 解析 SKILL.md
 *
 * @param raw 文件全文
 * @param filePath 仅用于错误信息定位
 */
export function parseSkillFrontmatter(
  raw: string,
  filePath = '<memory>',
): FrontmatterParseResult {
  const errors: string[] = [];
  const match = FRONTMATTER_RE.exec(raw);

  if (!match) {
    return {
      ok: false,
      errors: [`${filePath} 缺少 YAML frontmatter（文件必须以 --- 开头）`],
      body: raw,
    };
  }

  const yamlText = match[1] ?? '';
  // frontmatter 后通常跟一个空行，去掉它，让 body 直接从标题开始
  const body = (match[2] ?? '').replace(/^\r?\n/, '');

  let parsed: unknown;
  try {
    parsed = loadYaml(yamlText);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `${filePath} frontmatter 不是合法 YAML：${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
      body,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: [`${filePath} frontmatter 必须是一个 YAML 对象`],
      body,
    };
  }

  const data = parsed as Record<string, unknown>;

  // ── name ────────────────────────────────────────────────
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    errors.push(`${filePath} frontmatter 缺少必填字段 name`);
  } else if (!SAFE_SKILL_NAME_RE.test(name)) {
    errors.push(
      `${filePath} name "${name}" 不合法：只允许小写字母、数字和连字符，且以字母或数字开头（这也是目录名白名单）`,
    );
  }

  // ── description ─────────────────────────────────────────
  const description =
    typeof data.description === 'string' ? data.description.trim() : '';
  if (!description) {
    errors.push(`${filePath} frontmatter 缺少必填字段 description`);
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `${filePath} description 超长（${description.length} > ${MAX_DESCRIPTION_LENGTH}）`,
    );
  }

  // ── allowed-tools ───────────────────────────────────────
  const allowedTools = toToolList(data['allowed-tools'] ?? data.allowed_tools);

  // ── metadata ────────────────────────────────────────────
  const rawMeta = data.metadata;
  const metadata =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
      ? {
          author:
            typeof (rawMeta as any).author === 'string'
              ? String((rawMeta as any).author)
              : undefined,
          version:
            typeof (rawMeta as any).version === 'string' ||
            typeof (rawMeta as any).version === 'number'
              ? String((rawMeta as any).version)
              : undefined,
        }
      : undefined;

  if (errors.length > 0) {
    return { ok: false, errors, body };
  }

  return {
    ok: true,
    errors: [],
    body,
    frontmatter: {
      name,
      description,
      allowedTools,
      metadata: metadata ?? {},
    },
  };
}
