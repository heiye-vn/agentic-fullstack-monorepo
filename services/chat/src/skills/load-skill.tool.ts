/**
 * src/skills/load-skill.tool.ts
 *
 * 第十三章 13.4.2 — loadSkill Tool（标准写法）
 *
 * 与参考项目的三处不同：
 *
 * 1. **description 不列 skill 名**。教程 13.4.2 明确写了：索引由 middleware（这里是
 *    L1 注入函数）塞进 systemPrompt，工具描述保持通用。参考项目把两个 skill 名写死在
 *    description 里，加第三个 skill 就得改工具代码。
 * 2. **找不到时返回可用列表**，让 Agent 自行纠错；参考项目直接抛 ENOENT，
 *    异常会原样回到 ReAct 循环里污染上下文。
 * 3. **带 trace**：每次加载都记录 skillName / 版本 / 耗时 / 正文长度（13.10.4）。
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SkillRegistry } from './skill-registry.js';
import {
  buildSkillLoadTrace,
  SkillTraceCollector,
  type SkillTraceContext,
  type SkillLoadStatus,
} from './skill-trace.js';

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

export interface LoadSkillToolOptions {
  registry: SkillRegistry;
  traces?: SkillTraceCollector;
  /** trace 维度（requestId / conversationId / userId），一次请求内共享 */
  ctx?: SkillTraceContext;
  /** 是否连同 frontmatter 一起返回；默认只返回正文（更省 token） */
  includeFrontmatter?: boolean;
  logger?: (message: string) => void;
}

export function createLoadSkillTool(
  opts: LoadSkillToolOptions,
): DynamicStructuredTool {
  const { registry, traces, ctx, includeFrontmatter = false, logger } = opts;

  return new DynamicStructuredTool({
    name: LOAD_SKILL_TOOL_NAME,
    description: [
      '把某个技能的完整工作流指令加载进上下文。',
      '当你判断用户的请求属于某个专业领域时，先调用它拿到该领域规定的分析框架、',
      '工作流步骤与输出规范，然后严格按其中的步骤执行。',
      '传入的技能名不存在时，会返回可用技能列表。',
    ].join(''),
    schema: z.object({
      skillName: z.string().describe('要加载的技能名称'),
    }),
    func: async ({ skillName }) => {
      const startedAt = Date.now();
      const record = (
        status: SkillLoadStatus,
        hit: boolean,
        extra: { bodyLength?: number; body?: string; version?: string; message?: string } = {},
      ) => {
        traces?.add(
          buildSkillLoadTrace({
            ctx,
            skillName,
            skillVersion: extra.version,
            hit,
            durationMs: Date.now() - startedAt,
            bodyLength: extra.bodyLength ?? 0,
            status,
            errorMessage: extra.message,
            body: extra.body,
          }),
        );
      };

      const name = String(skillName ?? '').trim();

      if (!registry.has(name)) {
        const message = registry.buildNotFoundMessage(name);
        record('missing', false, { message });
        logger?.(`[load_skill] 未命中：${name}`);
        // 教程标准写法：给可用列表，让 Agent 自己纠正，而不是让工具调用失败
        return message;
      }

      try {
        const loaded = registry.readSkill(name);
        const content = includeFrontmatter ? loaded.raw : loaded.body;
        record(loaded.truncated ? 'truncated' : 'hit', true, {
          bodyLength: loaded.bodyLength,
          body: loaded.body,
          version: loaded.definition.version,
        });
        logger?.(
          `[load_skill] 命中：${name} v${loaded.definition.version}（${loaded.bodyLength} 字符）`,
        );
        return `Loaded skill: ${name}\n\n${content}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record('error', false, { message });
        logger?.(`[load_skill] 失败：${name} — ${message}`);
        // 工具失败也要返回可读字符串：抛异常会把堆栈塞进 ReAct 上下文
        return `加载技能失败：${message}`;
      }
    },
  });
}
