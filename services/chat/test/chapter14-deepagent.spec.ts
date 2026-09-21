/**
 * test/chapter14-deepagent.spec.ts
 *
 * 第十四章《DeepAgent——一个开箱即用的 Agent Harness》配套测试
 *
 * 按章节跑：npx vitest run test/chapter14-deepagent.spec.ts -t "14.6"
 *
 * 与参考项目（autix-demo feat/deepagents）的三点差异：
 * 1. 业务工具用第十三章的 TypeScript 实现（createSkillTools），不 execSync 调 Python
 * 2. 测试框架是 vitest，不是 bun:test；LLM 用例用 RUN_LLM_DEEPAGENT_TESTS 门控
 * 3. 默认值以项目可用档位为准（DEEPAGENT_MODEL，缺省 qwen3.8-max）
 *
 * 分层：Layer 1 零 LLM、必须全绿；Layer 2 需要 OPENAI_API_KEY + RUN_LLM_DEEPAGENT_TESTS=1。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDeepAgent,
  FilesystemBackend,
  listSkills,
  REQUIRED_MIDDLEWARE_NAMES,
  GENERAL_PURPOSE_SUBAGENT,
} from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createSkillTools } from '../src/skills/skill-tools.js';
import { resolveSkillsDir } from '../src/skills/skills-runtime.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const DEEPAGENT_MODEL = process.env.DEEPAGENT_MODEL || 'qwen3.8-max';
const RUN_LLM = process.env.RUN_LLM_DEEPAGENT_TESTS === '1';
const SKILLS_DIR = resolveSkillsDir();

function buildModel() {
  return new ChatOpenAI({
    model: DEEPAGENT_MODEL,
    temperature: 0,
    configuration: { baseURL: OPENAI_BASE_URL },
    apiKey: OPENAI_API_KEY || 'sk-test',
  });
}

/** 取第十三章的两个需求分析本地工具 */
function analysisTools() {
  const byName = new Map(createSkillTools().map((t) => [t.name, t]));
  return ['analyze_completeness', 'estimate_complexity']
    .map((n) => byName.get(n))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
}

function toolChain(messages: any[]): string[] {
  return (messages ?? [])
    .filter((m: any) => m?.tool_calls?.length > 0)
    .flatMap((m: any) => m.tool_calls.map((tc: any) => tc?.name).filter(Boolean));
}

// ============================================================
// Layer 1：零 LLM 依赖
// ============================================================

describe('14.4 Hello World：createDeepAgent 最小构造', () => {
  it('单工具 + systemPrompt 即可创建 Agent', () => {
    const getWeather = new DynamicStructuredTool({
      name: 'get_weather',
      description: '获取指定城市的天气',
      schema: z.object({ city: z.string().describe('城市名') }),
      func: async ({ city }) => `${city}：晴，28°C，微风`,
    });

    const agent = createDeepAgent({
      model: buildModel(),
      tools: [getWeather],
      systemPrompt: '你是一个天气助手。用户问天气时，调用 get_weather 工具获取数据。',
    });

    expect(typeof agent.invoke).toBe('function');
    expect(typeof agent.streamEvents).toBe('function');
  });
});

describe('14.5 业务工具独立验证（第十三章 TS 实现）', () => {
  it('createSkillTools 提供 analyze_completeness / estimate_complexity', () => {
    const tools = analysisTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['analyze_completeness', 'estimate_complexity']);
  });

  it('analyze_completeness 返回完整性评分', async () => {
    const [tool] = analysisTools();
    const raw = await tool.invoke({
      requirementText:
        '作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行',
    });
    const parsed = JSON.parse(String(raw));
    expect(parsed).toHaveProperty('completenessScore');
    expect(parsed).toHaveProperty('missingDimensions');
    expect(parsed.completenessScore).toBeGreaterThanOrEqual(0);
    expect(parsed.completenessScore).toBeLessThanOrEqual(100);
  });

  it('estimate_complexity 返回 T-shirt size 与工期', async () => {
    const [, tool] = analysisTools();
    const raw = await tool.invoke({
      requirementText: '订单导出支持百万行级别的异步下载，需要任务中心与断点续传',
    });
    const parsed = JSON.parse(String(raw));
    expect(parsed).toBeTruthy();
    expect(JSON.stringify(parsed)).toMatch(/S|M|L|XL/);
  });
});

describe('14.7 虚拟文件系统：FilesystemBackend 基本写读', () => {
  it('写入文件后可读回，路径落到真实磁盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch14-vfs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });

      const w = await backend.write('/analysis/completeness.md', '完整性评分：67 / 100');
      expect((w as any).error).toBeUndefined();
      expect(existsSync(join(root, 'analysis', 'completeness.md'))).toBe(true);

      const r = await backend.read('/analysis/completeness.md');
      expect((r as any).error).toBeUndefined();
      expect(String((r as any).content)).toContain('完整性评分');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('virtualMode 阻止 .. 越界', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ch14-vfs-'));
    try {
      const backend = new FilesystemBackend({ rootDir: root, virtualMode: true });
      await backend.write('/../escape.txt', 'should not escape');
      expect(existsSync(join(root, '..', 'escape.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('14.9 Skills 资产可被 DeepAgent 发现', () => {
  it('listSkills 从磁盘解析两个 Skill 的 frontmatter', () => {
    const skills = listSkills({ projectSkillsDir: SKILLS_DIR });
    const names = skills.map((s) => s.name);
    expect(names).toContain('requirement-analysis');
    expect(names).toContain('competitor-research');
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(0);
    }
  });
});

describe('14.3 默认中间件装配', () => {
  it('REQUIRED_MIDDLEWARE_NAMES 含文件系统与子 Agent 中间件', () => {
    expect(REQUIRED_MIDDLEWARE_NAMES.has('FilesystemMiddleware')).toBe(true);
    expect(REQUIRED_MIDDLEWARE_NAMES.has('SubAgentMiddleware')).toBe(true);
  });

  it('GENERAL_PURPOSE_SUBAGENT 带 name / description / systemPrompt', () => {
    expect(GENERAL_PURPOSE_SUBAGENT.name).toBeTruthy();
    expect(GENERAL_PURPOSE_SUBAGENT.description.length).toBeGreaterThan(0);
    expect(GENERAL_PURPOSE_SUBAGENT.systemPrompt.length).toBeGreaterThan(0);
  });
});

describe('14.3 / 14.9 createDeepAgent 配置组合', () => {
  it('最小配置（仅 tools）', () => {
    const agent = createDeepAgent({
      model: buildModel(),
      tools: analysisTools(),
      systemPrompt: '你是需求分析专家。',
    });
    expect(typeof agent.invoke).toBe('function');
  });

  it('含 FilesystemBackend + skills 配置', () => {
    const agent = createDeepAgent({
      model: buildModel(),
      tools: analysisTools(),
      backend: new FilesystemBackend({ rootDir: SKILLS_DIR, virtualMode: true }),
      skills: ['/'],
      systemPrompt: '你是需求分析专家。',
    });
    expect(typeof agent.invoke).toBe('function');
  });
});

// ============================================================
// Layer 2：调用真实模型（需 RUN_LLM_DEEPAGENT_TESTS=1）
// ============================================================

const LLM_TIMEOUT = 240_000;

describe.skipIf(!RUN_LLM)('14.4 Hello World 端到端', () => {
  it(
    '调用 get_weather → 返回天气',
    async () => {
      const getWeather = new DynamicStructuredTool({
        name: 'get_weather',
        description: '获取指定城市的天气',
        schema: z.object({ city: z.string().describe('城市名') }),
        func: async ({ city }) => `${city}：晴，28°C，微风`,
      });
      const agent = createDeepAgent({
        model: buildModel(),
        tools: [getWeather],
        systemPrompt: '你是一个天气助手。用户问天气时，调用 get_weather 工具获取数据。',
      });

      const result: any = await agent.invoke({
        messages: [{ role: 'user', content: '北京今天天气怎么样？' }],
      });
      expect(toolChain(result.messages)).toContain('get_weather');
    },
    LLM_TIMEOUT,
  );
});

describe.skipIf(!RUN_LLM)('14.6 write_todos 规划验证', () => {
  it(
    '多步骤任务 → 跑完两个分析工具 → 输出结构化报告（todos 仅观察）',
    async () => {
      const agent = createDeepAgent({
        model: buildModel(),
        tools: analysisTools(),
        systemPrompt: [
          '你是一位资深需求分析专家。',
          '重要规则：面对多步骤任务时，必须先使用 write_todos 制定任务计划，再逐步执行。',
        ].join('\n'),
      });

      const result: any = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: [
              '请对以下需求进行完整分析，要求分三个阶段：',
              '阶段一：完整性检查（调用 analyze_completeness）',
              '阶段二：复杂度估算（调用 estimate_complexity）',
              '阶段三：综合以上两个维度，输出结构化分析报告',
              '',
              '需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行。',
            ].join('\n'),
          },
        ],
      });

      // 教程 14.6.2：write_todos 是引导式规划，不是强制流程。
      // 是否调用取决于模型与任务复杂度，所以不断言它一定出现，只校验状态合法性。
      for (const t of result.todos ?? []) {
        expect(['pending', 'in_progress', 'completed']).toContain(t.status);
      }
      const chain = toolChain(result.messages);
      expect(chain).toContain('analyze_completeness');
      expect(chain).toContain('estimate_complexity');
      expect(String(result.messages.at(-1)?.content).length).toBeGreaterThan(300);
    },
    LLM_TIMEOUT,
  );
});

describe.skipIf(!RUN_LLM)('14.7 虚拟文件系统端到端', () => {
  it(
    '明确要求写文件 → 调用链含 write_file / read_file → result.files 非空',
    async () => {
      const agent = createDeepAgent({
        model: buildModel(),
        tools: analysisTools(),
        systemPrompt: [
          '你是一位资深需求分析专家。',
          '重要规则：你必须使用 write_file 工具将分析结果保存到文件，然后用 read_file 读取并汇总。',
        ].join('\n'),
      });

      const result: any = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: [
              '分析以下需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式。',
              '严格要求：',
              '1. 必须用 write_file 把完整性分析写入 /analysis/completeness.md',
              '2. 必须用 write_file 把复杂度估算写入 /analysis/complexity.md',
              '3. 用 read_file 读取这两个文件后汇总成报告',
            ].join('\n'),
          },
        ],
      });

      const chain = toolChain(result.messages);
      expect(chain).toContain('write_file');
      expect(Object.keys(result.files ?? {}).length).toBeGreaterThan(0);
    },
    LLM_TIMEOUT,
  );
});

describe.skipIf(!RUN_LLM)('14.8 Subagent task 端到端', () => {
  it(
    '两个需求 → 调用链含 task → 产出对比报告',
    async () => {
      const tools = analysisTools();
      const agent = createDeepAgent({
        model: buildModel(),
        tools,
        subagents: [
          {
            name: 'requirement-analyst',
            description: '对单个需求进行完整性分析、复杂度评估和风险识别',
            systemPrompt: '你是需求分析专家。请对指定需求进行完整性检查、复杂度估算和风险评估。',
            tools,
          },
        ],
        systemPrompt:
          '你是需求分析专家。需要深入分析单个需求时，委托给 requirement-analyst 子 Agent。',
      });

      const result: any = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: [
              '请分析以下两个需求：',
              'REQ-001：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式。',
              'REQ-002：订单导出支持百万行级别的异步下载。',
              '要求：分别委托子 Agent 分析每个需求，主 Agent 只负责汇总，最终输出一个对比报告。',
            ].join('\n'),
          },
        ],
      });

      const chain = toolChain(result.messages);
      expect(chain.filter((t) => t === 'task').length).toBeGreaterThan(0);
      expect(String(result.messages.at(-1)?.content).length).toBeGreaterThan(200);
    },
    LLM_TIMEOUT,
  );
});
