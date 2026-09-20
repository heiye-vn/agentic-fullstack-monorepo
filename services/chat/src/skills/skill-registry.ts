/**
 * src/skills/skill-registry.ts
 *
 * 第十三章 13.3 + 13.10 — Skill 注册表：扫描、索引、安全读取、工具校验
 *
 * 参考项目（autix-demo）里 load_skill 只有一行 `readFileSync(join(dir, skillName, 'SKILL.md'))`，
 * 这里补齐它缺的四件事：
 *
 * 1. **索引不是写死的**：启动时扫描目录 + 解析 frontmatter，加 Skill 只需丢一个目录（13.4.3）
 * 2. **安全边界**（13.10.1）：skillName 白名单 + 路径前缀校验 + 不存在时返回可用列表
 * 3. **工具校验**（13.10.2）：启动时比对 allowed-tools 与实际工具栈，改名/漏注册当场发现
 * 4. **体积上限**：Skill 正文过长时截断，避免单个资产吃掉整轮上下文
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  parseSkillFrontmatter,
  SAFE_SKILL_NAME_RE,
} from './skill-frontmatter.js';
import type {
  LoadedSkill,
  SkillDefinition,
  SkillToolValidation,
  SkillValidationReport,
} from './skill-types.js';

export interface SkillRegistryOptions {
  /** 单个 Skill 正文的最大字符数，超出截断（默认 20000） */
  maxContentChars?: number;
  /** 是否缓存已读内容（默认 true） */
  cache?: boolean;
}

export class SkillRegistry {
  private definitions = new Map<string, SkillDefinition>();
  private cache = new Map<string, string>();
  private loadErrors: string[] = [];
  private readonly maxContentChars: number;
  private readonly useCache: boolean;

  constructor(
    private readonly rootDir: string,
    opts: SkillRegistryOptions = {},
  ) {
    this.maxContentChars = opts.maxContentChars ?? 20_000;
    this.useCache = opts.cache ?? true;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  /**
   * 扫描目录加载所有 Skill
   *
   * 单个 Skill 解析失败只跳过它自己，不影响其它 Skill —— 资产写错不该让服务起不来。
   */
  load(): SkillDefinition[] {
    this.definitions.clear();
    this.cache.clear();
    this.loadErrors = [];

    if (!existsSync(this.rootDir)) {
      this.loadErrors.push(`Skill 目录不存在：${this.rootDir}`);
      return [];
    }

    let entries;
    try {
      entries = readdirSync(this.rootDir, { withFileTypes: true });
    } catch (err) {
      this.loadErrors.push(
        `读取 Skill 目录失败：${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = join(this.rootDir, entry.name, 'SKILL.md');
      if (!existsSync(filePath)) continue;

      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch (err) {
        this.loadErrors.push(
          `${entry.name}/SKILL.md 读取失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      const parsed = parseSkillFrontmatter(raw, `${entry.name}/SKILL.md`);
      if (!parsed.ok || !parsed.frontmatter) {
        this.loadErrors.push(...parsed.errors);
        continue;
      }

      const fm = parsed.frontmatter;
      // frontmatter 里的 name 必须和目录名一致，否则"按名找目录"和"按目录名找"会分叉
      if (fm.name !== entry.name) {
        this.loadErrors.push(
          `${entry.name}/SKILL.md 的 name "${fm.name}" 与目录名不一致，已按 frontmatter 注册`,
        );
      }

      this.definitions.set(fm.name, {
        name: fm.name,
        description: fm.description,
        allowedTools: fm.allowedTools,
        version: fm.metadata?.version ?? '0.0.0',
        author: fm.metadata?.author,
        dirPath: resolve(this.rootDir, entry.name),
        filePath: resolve(filePath),
      });
    }

    return this.list();
  }

  /** 已加载的 Skill 列表（按 name 排序，保证 prompt 稳定） */
  list(): SkillDefinition[] {
    return Array.from(this.definitions.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  get(name: string): SkillDefinition | undefined {
    return this.definitions.get(name);
  }

  names(): string[] {
    return this.list().map((s) => s.name);
  }

  getLoadErrors(): string[] {
    return [...this.loadErrors];
  }

  /**
   * 13.10.1 安全边界：把 skillName 解析成安全的 SKILL.md 绝对路径
   *
   * 三道闸：
   * 1. 正则白名单（kebab-case，天然挡掉 ../ 和绝对路径）
   * 2. 必须在注册表里（未注册的名字一律拒绝，不让它落到文件系统）
   * 3. resolve 后校验仍在 rootDir 之内（防白名单被绕过时的兜底）
   */
  resolveSkillPath(name: string): string {
    if (!SAFE_SKILL_NAME_RE.test(name)) {
      throw new Error(
        `非法的 skillName："${name}"（只允许小写字母、数字和连字符）`,
      );
    }

    const def = this.definitions.get(name);
    if (!def) {
      throw new Error(this.buildNotFoundMessage(name));
    }

    const root = resolve(this.rootDir);
    const target = resolve(def.filePath);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`skillName "${name}" 解析后越出了 Skill 根目录`);
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new Error(`Skill "${name}" 的 SKILL.md 不存在或不是文件`);
    }
    return target;
  }

  /**
   * 读一个 Skill 的完整内容（L2）
   *
   * 教程标准写法要求：找不到时返回可用列表，让 Agent 自行纠错，而不是抛异常炸掉工具调用。
   */
  readSkill(name: string): LoadedSkill {
    const def = this.definitions.get(name);
    if (!def) {
      throw new Error(this.buildNotFoundMessage(name));
    }

    const path = this.resolveSkillPath(name);
    let raw = this.useCache ? this.cache.get(name) : undefined;
    if (raw === undefined) {
      raw = readFileSync(path, 'utf-8');
      if (this.useCache) this.cache.set(name, raw);
    }

    const parsed = parseSkillFrontmatter(raw, `${name}/SKILL.md`);
    const body = parsed.ok ? parsed.body : raw;

    let trimmed = body.trim();
    let truncated = false;
    if (trimmed.length > this.maxContentChars) {
      trimmed = `${trimmed.slice(0, this.maxContentChars)}\n\n> （内容超过 ${this.maxContentChars} 字符已被截断）`;
      truncated = true;
    }

    return {
      definition: def,
      body: trimmed,
      raw,
      bodyLength: trimmed.length,
      ...(truncated ? { truncated: true } : {}),
    } as LoadedSkill;
  }

  /** 找不到 Skill 时的提示文案：给出可用列表，且不含任何绝对路径 */
  buildNotFoundMessage(name: string): string {
    const available = this.names();
    return available.length > 0
      ? `Skill '${name}' 不存在。可用技能：${available.join(', ')}`
      : `Skill '${name}' 不存在，且当前没有已注册的技能`;
  }

  /**
   * 13.4.3 L1 索引：name + description 的列表
   *
   * 对应 Custom Pattern 里 createMiddleware 注入 systemPrompt 的那段内容。
   * 只有这两个字段进 prompt —— 正文要等 Agent 用 load_skill 主动加载。
   */
  buildIndex(): string {
    const skills = this.list();
    if (skills.length === 0) return '';
    return skills
      .map((s) => `- **${s.name}**（v${s.version}）：${s.description}`)
      .join('\n');
  }

  /** 所有 Skill 声明过的工具名并集，用于工具栈裁剪 */
  collectDeclaredTools(): string[] {
    const set = new Set<string>();
    for (const s of this.list()) {
      for (const t of s.allowedTools) set.add(t);
    }
    return Array.from(set).sort();
  }

  /**
   * 13.10.2 启动期工具校验
   *
   * `load_skill` 永远由运行时提供，不参与校验（它不是 Skill 自带的）。
   * 外部工具（MCP 的 req_* / ws_*）允许缺失 —— SKILL.md 里已写明"不存在就跳过"，
   * 所以这里只报不拦。
   */
  validateTools(
    availableToolNames: string[],
    opts: { optionalTools?: string[] } = {},
  ): SkillValidationReport {
    const available = new Set(availableToolNames);
    const optional = new Set(opts.optionalTools ?? []);
    const skills: SkillToolValidation[] = [];

    for (const s of this.list()) {
      const missing: string[] = [];
      const resolved: string[] = [];
      for (const tool of s.allowedTools) {
        if (tool === 'load_skill' || available.has(tool)) resolved.push(tool);
        else missing.push(tool);
      }
      skills.push({ skillName: s.name, missing, resolved });
    }

    const hardMissing = skills.reduce(
      (n, s) =>
        n + s.missing.filter((t) => !optional.has(t) && !/^(req_|ws_)/.test(t)).length,
      0,
    );

    return {
      skills,
      ok: hardMissing === 0,
      missingCount: skills.reduce((n, s) => n + s.missing.length, 0),
    };
  }
}
