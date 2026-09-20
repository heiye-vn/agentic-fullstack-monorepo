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

/** 进程级共享实例：Skill 资产是静态的，没必要每次请求重新扫盘 */
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
