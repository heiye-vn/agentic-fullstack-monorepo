/**
 * src/skills/skills-runtime.ts
 *
 * 第十三章 13.4 + 13.9 — 把 Skills 装配成 Agent 可直接使用的工具栈
 *
 * 这一层解决三件事：
 * 1. **资产目录在哪**：dist 里也要有 SKILL.md（靠 nest-cli assets 复制），
 *    找不到时回退到源码目录，保证 tsx / vitest 下同样能跑
 * 2. **L1 索引注入**（13.4.3）：把 name + description 生成一段 prompt 追加到 systemPrompt，
 *    等价于 LangChain 的 createMiddleware —— 本项目用的是 LangGraph StateGraph，
 *    没有 middleware 机制，所以在装配阶段把这段拼进专家的 systemPrompt
 * 3. **工具来源混合**（13.9.1）：allowed-tools 只写工具名，本地工具来自 createSkillTools()，
 *    外部工具来自第十二章 MCPManager.getTools()，同名即命中
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { SkillRegistry } from './skill-registry.js';
import { SkillTraceCollector } from './skill-trace.js';
import { createSkillTools } from './skill-tools.js';
import {
  createLoadSkillTool,
  LOAD_SKILL_TOOL_NAME,
} from './load-skill.tool.js';
import type { SkillValidationReport } from './skill-types.js';

export interface SkillRuntimeOptions {
  /** 显式开关；不给则读 SKILLS_ENABLED，默认开启（纯本地资产，无外部依赖） */
  enabled?: boolean;
  /** Skill 根目录（含各 Skill 子目录）；不给则自动定位 */
  rootDir?: string;
  maxContentChars?: number;
  /** 第十二章 MCP 工具，按 allowed-tools 声明的名字挑选 */
  mcpTools?: any[];
  /** trace 维度，便于与 MCP / Token trace 串成同一条链路 */
  trace?: { requestId?: string; conversationId?: string; userId?: string };
  logger?: (message: string) => void;
}

export interface SkillRuntime {
  registry: SkillRegistry;
  /** load_skill + 本地 Skill 工具 + 命中的 MCP 工具 */
  tools: DynamicStructuredTool[];
  /** L1 索引，追加到 systemPrompt */
  indexPrompt: string;
  traces: SkillTraceCollector;
  /** 13.10.2 启动期工具校验结果 */
  report: SkillValidationReport | null;
  /** 资产解析错误（写坏的 SKILL.md 会在这里列出，但不阻断启动） */
  errors: string[];
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function currentDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * 定位 Skill 资产目录
 *
 * 打包后 `dist/skills/definitions/*.md` 由 nest-cli 的 assets 复制过去；
 * 用 tsx / vitest 直接跑源码时，文件还在 `src/skills/definitions`。
 */
export function resolveSkillsDir(explicit?: string): string {
  if (explicit) return explicit;

  const fromEnv = process.env.SKILLS_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    join(currentDir(), 'definitions'),
    join(process.cwd(), 'src', 'skills', 'definitions'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

/** 13.4.3 L1 索引：等价于 createMiddleware 注入的那段 systemPrompt 追加内容 */
export function buildSkillIndexPrompt(registry: SkillRegistry): string {
  const index = registry.buildIndex();
  if (!index) return '';
  return [
    '## 可用技能（Skills）',
    '',
    index,
    '',
    `当你判断本次任务命中上面某个技能时，先用 ${LOAD_SKILL_TOOL_NAME} 加载它，`,
    '拿到完整的分析框架、工作流步骤与输出规范后，严格按其中的步骤执行。',
    '技能里提到的外部工具可能不在你的工具列表中，没有就跳过对应步骤并在结论里说明。',
  ].join('\n');
}

/**
 * 第二十章 20.5：把某个 Skill 的**方法论正文**拼成可前置注入的上下文块。
 *
 * 与第十三章已有的两种注入方式互补，三种分别解决不同问题：
 *   - indexPrompt（L1）：只列 name + description，让 Agent 知道"有这个技能" —— 成本极低
 *   - load_skill 工具（L2）：Agent 自己判断需要时加载正文 —— 按需、省 token
 *   - 本函数（确定性层）：对主链路每轮无条件带上正文 —— 不赌 Agent 这一次会不会调用工具
 *
 * 前两种都依赖模型「想起去做」，第三种保证下限：需求分析这条主链路上，
 * 就算模型一次 load_skill 都没调，报告也应当按照既定框架产出。
 * 代价是每轮固定 token 开销，所以带 maxChars 上限兜底（默认 8000 字符）。
 *
 * 与前两种方法共用同一个 registry：技能资产只有一份，不存在"注入的正文和工具加载的不一致"。
 */
export function buildMethodologyBlock(
  skillName: string,
  registry: SkillRegistry,
  maxChars = DEFAULT_METHODOLOGY_MAX_CHARS,
): string {
  if (!registry.has(skillName)) return '';
  try {
    const loaded = registry.readSkill(skillName);
    const body = (loaded.body ?? '').trim();
    if (!body) return '';
    const clipped =
      body.length > maxChars ? `${body.slice(0, maxChars)}\n…（方法论已截断）` : body;
    return `## 分析方法论（Skill: ${loaded.definition?.name ?? skillName}）\n${clipped}`;
  } catch {
    // 资产读不了就降级为不注入，主链路照常，绝不因为缺方法论而让对话失败
    return '';
  }
}

/** 20.5 方法论正文的字符上限，防止 SKILL.md 写得过长时把 prompt 撑爆。 */
export const DEFAULT_METHODOLOGY_MAX_CHARS = 8000;

/**
 * 20.5：需求分析主链路默认前置注入的 Skill 名。
 * 抽出常量是为了让「谁是默认方法论」这一处在代码里只有一个答案。
 */
export const DEFAULT_ANALYSIS_SKILL = 'requirement-analysis';

/**
 * 按 allowed-tools 组装工具栈
 *
 * load_skill 永远在列（它是 Skill 机制的入口，不由 SKILL.md 声明）。
 * MCP 工具按名字命中 —— 工具名是公共契约，MCP Server 侧改名会让这里静默失效，
 * 所以启动时用 validateTools 把缺失项报出来。
 */
export function buildSkillToolSet(
  registry: SkillRegistry,
  opts: SkillRuntimeOptions = {},
): { tools: DynamicStructuredTool[]; traces: SkillTraceCollector } {
  const declared = new Set(registry.collectDeclaredTools());
  const traces = new SkillTraceCollector();

  const localTools = createSkillTools().filter((t) => declared.has(t.name));
  const mcpPicked = (opts.mcpTools ?? []).filter((t: any) =>
    declared.has(String(t?.name ?? '')),
  );

  const loadSkill = createLoadSkillTool({
    registry,
    traces,
    ctx: opts.trace,
    logger: opts.logger,
  });

  return { tools: [loadSkill, ...localTools, ...mcpPicked], traces };
}

/**
 * 装配 Skill 运行时
 *
 * 未启用时返回 null，调用方保持原行为 —— 与第十二章 MCP 的处理一致：
 * 增强能力不可用不应该让主链路失败。
 */
export function createSkillRuntime(
  opts: SkillRuntimeOptions = {},
): SkillRuntime | null {
  const enabled = opts.enabled ?? envFlag('SKILLS_ENABLED', true);
  if (!enabled) return null;

  const logger = opts.logger ?? ((m: string) => console.log(`[skills] ${m}`));
  const rootDir = resolveSkillsDir(opts.rootDir);
  const maxContentChars =
    opts.maxContentChars ??
    (Number(process.env.SKILLS_MAX_CONTENT_CHARS) || undefined);
  const registry = new SkillRegistry(rootDir, { maxContentChars });

  const definitions = registry.load();
  const errors = registry.getLoadErrors();
  for (const e of errors) logger(`资产加载告警：${e}`);

  const { tools, traces } = buildSkillToolSet(registry, opts);
  const declared = new Set(registry.collectDeclaredTools());
  const availableNames = tools.map((t) => String(t.name));

  const report = registry.validateTools(availableNames, {
    // 外部工具由 MCP 提供，缺失是预期内的（MCP_ENABLED 未开就都没有）
    optionalTools: Array.from(declared).filter((n) => /^(req_|ws_)/.test(n)),
  });

  if (!report.ok || report.missingCount > 0) {
    for (const s of report.skills) {
      if (s.missing.length > 0) {
        logger(`技能 ${s.skillName} 声明的工具缺失：${s.missing.join(', ')}`);
      }
    }
  }

  return {
    registry,
    tools,
    indexPrompt: buildSkillIndexPrompt(registry),
    traces,
    report,
    errors: [...errors, ...(definitions.length === 0 ? ['未加载到任何 Skill'] : [])],
  };
}

let shared: SkillRuntime | null | undefined;

/**
 * 进程级共享实例：Skill 资产是静态的，没必要每次请求重新扫盘
 *
 * ⚠️ **opts 只在首次调用生效**（缓存命中后不再重算）。工具栈要混合第十二章的 MCP 工具
 * （教程 13.9.1），所以第一次调用必须把 mcpTools 带上，否则缓存会被固化成
 * 「没有 MCP 工具」的版本，技能声明的 req_ / ws_ 前缀工具永久缺失。
 * AppModule.onApplicationBootstrap 里就是按「先 MCP、后 Skills」的顺序预热的。
 */
export function getSharedSkillRuntime(
  opts: SkillRuntimeOptions = {},
): SkillRuntime | null {
  if (shared === undefined) {
    shared = createSkillRuntime(opts);
  }
  return shared;
}

/** 仅供测试：清掉共享实例，避免用例之间互相污染 */
export function resetSharedSkillRuntime(): void {
  shared = undefined;
}
