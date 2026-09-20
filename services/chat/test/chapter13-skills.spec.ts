/**
 * test/chapter13-skills.spec.ts
 *
 * 第十三章《Skills——把最佳实践沉淀为能力资产》配套测试
 *
 * 与第十二章一致的组织方式：describe 标题以「13.x」开头，方便按章节跑：
 *   npx vitest run test/chapter13-skills.spec.ts -t "13.4"
 *
 * 设计原则（也是和参考项目最大的不同）：
 * 1. 读的是 **真实的 SKILL.md 资产**，不是在 spec 里复制一份内容 —— 资产改了测试要红
 * 2. 全部零 LLM 依赖。参考项目的端到端用例必须跑真模型，这里把可验证的部分全部做成确定性断言
 * 3. 安全边界、工具校验、可观测性是参考项目完全没有的，单独成节
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSkillFrontmatter } from '../src/skills/skill-frontmatter.js';
import { SkillRegistry } from '../src/skills/skill-registry.js';
import { createLoadSkillTool } from '../src/skills/load-skill.tool.js';
import {
  analyzeRequirementCompleteness,
  estimateRequirementComplexity,
  searchCompetitors,
  searchBestPractices,
  createSkillTools,
  SKILL_LOCAL_TOOL_NAMES,
} from '../src/skills/skill-tools.js';
import { SkillTraceCollector, summarizeSkillTraces } from '../src/skills/skill-trace.js';
import {
  createSkillRuntime,
  buildSkillIndexPrompt,
  buildSkillToolSet,
  resolveSkillsDir,
} from '../src/skills/skills-runtime.js';
import {
  withSkillTools,
  buildSkillPromptAddendum,
} from '../src/llm/graph/experts.js';

const SKILLS_DIR = resolveSkillsDir();

function readSkillFile(name: string): string {
  return readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8');
}

// ============================================================
// 13.3.1 frontmatter 解析与校验
// ============================================================

describe('13.3.1 SKILL.md frontmatter 解析', () => {
  it('真实资产能被解析出规范四字段', () => {
    const parsed = parseSkillFrontmatter(
      readSkillFile('requirement-analysis'),
      'requirement-analysis/SKILL.md',
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.frontmatter?.name).toBe('requirement-analysis');
    expect(parsed.frontmatter?.description).toContain('分析需求');
    expect(parsed.frontmatter?.allowedTools).toContain('analyze_completeness');
    expect(parsed.frontmatter?.metadata?.version).toBe('1.0.0');
  });

  it('body 是去掉 frontmatter 的正文', () => {
    const parsed = parseSkillFrontmatter(readSkillFile('competitor-research'));
    expect(parsed.ok).toBe(true);
    expect(parsed.body.startsWith('# 竞品调研 Skill')).toBe(true);
    expect(parsed.body).not.toContain('allowed-tools');
  });

  it('allowed-tools 支持逗号字符串与数组两种写法', () => {
    const asString = parseSkillFrontmatter(
      ['---', 'name: a', 'description: d', 'allowed-tools: x, y', '---', '# A'].join('\n'),
    );
    const asArray = parseSkillFrontmatter(
      [
        '---',
        'name: a',
        'description: d',
        'allowed-tools:',
        '  - x',
        '  - y',
        '---',
        '# A',
      ].join('\n'),
    );
    expect(asString.frontmatter?.allowedTools).toEqual(['x', 'y']);
    expect(asArray.frontmatter?.allowedTools).toEqual(['x', 'y']);
  });

  it('缺 name / description 时报错而不是静默通过', () => {
    const noName = parseSkillFrontmatter(['---', 'description: d', '---', '# A'].join('\n'));
    const noDesc = parseSkillFrontmatter(['---', 'name: a', '---', '# A'].join('\n'));
    expect(noName.ok).toBe(false);
    expect(noName.errors.join()).toContain('name');
    expect(noDesc.ok).toBe(false);
    expect(noDesc.errors.join()).toContain('description');
  });

  it('name 只允许 kebab-case（第一道路径安全闸）', () => {
    const evil = parseSkillFrontmatter(
      ['---', 'name: ../../etc/passwd', 'description: d', '---', '# A'].join('\n'),
    );
    expect(evil.ok).toBe(false);
    expect(evil.errors.join()).toContain('不合法');
  });

  it('没有 frontmatter 时给出可定位的错误', () => {
    const r = parseSkillFrontmatter('# 直接就是正文', 'bad/SKILL.md');
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('bad/SKILL.md');
  });
});

// ============================================================
// 13.3.2 注册表扫描与 L1 索引
// ============================================================

describe('13.3.2 SkillRegistry 扫描与索引', () => {
  let registry: SkillRegistry;

  beforeAll(() => {
    registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
  });

  it('扫描目录得到已注册的 Skill', () => {
    expect(registry.names()).toEqual([
      'competitor-research',
      'requirement-analysis',
    ]);
    expect(registry.getLoadErrors()).toEqual([]);
  });

  it('L1 索引只有 name + description，不含正文', () => {
    const index = registry.buildIndex();
    expect(index).toContain('requirement-analysis');
    expect(index).toContain('competitor-research');
    expect(index).not.toContain('## 工作流');
  });

  it('collectDeclaredTools 汇总所有 Skill 声明的工具', () => {
    const tools = registry.collectDeclaredTools();
    for (const name of SKILL_LOCAL_TOOL_NAMES) {
      expect(tools).toContain(name);
    }
    // 第十二章 MCP 工具也被声明进来（13.9.1：工具来源不限）
    expect(tools).toContain('req_analyze_completeness');
    expect(tools).toContain('ws_search_best_practices');
  });
});

// ============================================================
// 13.10.1 安全边界
// ============================================================

describe('13.10.1 load_skill 安全边界', () => {
  let registry: SkillRegistry;

  beforeAll(() => {
    registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
  });

  it('路径穿越被拒', () => {
    expect(() => registry.resolveSkillPath('../..')).toThrow(/非法/);
    expect(() => registry.resolveSkillPath('/etc/passwd')).toThrow(/非法/);
    expect(() =>
      registry.resolveSkillPath('requirement-analysis/../../package.json'),
    ).toThrow(/非法/);
  });

  it('未注册的 skillName 不会落到文件系统', () => {
    expect(() => registry.resolveSkillPath('not-a-skill')).toThrow(/不存在/);
  });

  it('不存在时返回可用列表，且不泄露绝对路径', () => {
    const message = registry.buildNotFoundMessage('whatever');
    expect(message).toContain('requirement-analysis');
    expect(message).not.toContain(SKILLS_DIR);
  });
});

// ============================================================
// 13.4.2 load_skill 工具
// ============================================================

describe('13.4.2 loadSkill Tool', () => {
  it('命中时返回正文，且默认剥离 frontmatter', async () => {
    const registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
    const tool = createLoadSkillTool({ registry });

    const out = await tool.invoke({ skillName: 'requirement-analysis' });
    expect(out).toContain('Loaded skill: requirement-analysis');
    expect(out).toContain('## 工作流');
    expect(out).not.toContain('allowed-tools');
  });

  it('未命中时返回可用列表而不是抛异常', async () => {
    const registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
    const tool = createLoadSkillTool({ registry });

    const out = await tool.invoke({ skillName: 'does-not-exist' });
    expect(out).toContain('不存在');
    expect(out).toContain('requirement-analysis');
  });

  it('每次加载都留下 trace（13.10.4）', async () => {
    const registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
    const traces = new SkillTraceCollector();
    const tool = createLoadSkillTool({ registry, traces });

    await tool.invoke({ skillName: 'requirement-analysis' });
    await tool.invoke({ skillName: 'nope' });

    const list = traces.list();
    expect(list).toHaveLength(2);
    expect(list[0].hit).toBe(true);
    expect(list[0].status).toBe('hit');
    expect(list[0].skillVersion).toBe('1.0.0');
    expect(list[0].bodyLength).toBeGreaterThan(500);
    expect(list[1].hit).toBe(false);
    expect(list[1].status).toBe('missing');
  });
});

// ============================================================
// 13.8.4 Skill 自带本地工具
// ============================================================

describe('13.8.4 本地 Skill 工具', () => {
  it('analyze_completeness：六维度打分', () => {
    const r = analyzeRequirementCompleteness(
      '作为管理员，我需要能够批量导入用户数据，支持 CSV 格式',
    );
    expect(r.completenessScore).toBeGreaterThan(0);
    expect(r.completenessScore).toBeLessThan(100);
    expect(r.coveredDimensions).toContain('用户角色');
    expect(r.coveredDimensions).toContain('功能描述');
    expect(r.missingDimensions).toContain('验收标准');
    expect(r.suggestion).toContain('建议补充');
  });

  it('analyze_completeness：六项齐全时满分', () => {
    const r = analyzeRequirementCompleteness(
      '作为管理员（角色），需要支持批量导入（功能），验收标准是导入成功率 100%（验收），P0 优先级（优先级），要求 1000 QPS（性能），超限重试且失败告警（边界）',
    );
    expect(r.completenessScore).toBe(100);
    expect(r.missingDimensions).toHaveLength(0);
  });

  it('estimate_complexity：命中因子决定 T-shirt size', () => {
    const simple = estimateRequirementComplexity('修改一个按钮文案');
    const hard = estimateRequirementComplexity(
      '批量导入用户数据，对接第三方 API，要求实时推送，需要搜索匹配算法',
    );
    expect(['S', 'M', 'L', 'XL']).toContain(simple.size);
    expect(simple.factors).toHaveLength(0);
    expect(hard.size).toBe('XL');
    expect(hard.factors.join()).toContain('批量处理');
    expect(hard.estimatedDays).toBeGreaterThan(simple.estimatedDays);
    expect(hard.dayRange.max).toBeGreaterThan(hard.dayRange.min);
  });

  it('search_competitors：按关键词命中本地竞品库', () => {
    const r = searchCompetitors('项目管理工具');
    expect(r.results.length).toBeGreaterThanOrEqual(2);
    expect(r.results[0].name).toBeTruthy();
    expect(r.results[0].pricing).toBeTruthy();
    // 命中结果按相关度排序
    expect(r.results[0].matchScore).toBeGreaterThanOrEqual(
      r.results[r.results.length - 1].matchScore,
    );
  });

  it('search_competitors：无命中时给明确说明而不是空数组', () => {
    const r = searchCompetitors('量子计算编译器');
    expect(r.results).toHaveLength(0);
    expect(r.note).toContain('未命中');
  });

  it('search_best_practices：命中与兜底', () => {
    const hit = searchBestPractices('批量导入');
    expect(hit.practices.length).toBeGreaterThan(0);
    expect(hit.practices[0].title).toBeTruthy();

    const miss = searchBestPractices('不存在的主题xyz');
    expect(miss.practices.length).toBeGreaterThan(0);
    expect(miss.note).toContain('未命中');
  });

  it('createSkillTools 给出 4 个带 zod schema 的 LangChain 工具', () => {
    const tools = createSkillTools();
    expect(tools.map((t) => t.name)).toEqual([...SKILL_LOCAL_TOOL_NAMES]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect((t as any).schema).toBeDefined();
    }
  });
});

// ============================================================
// 13.9.1 工具来源混合：本地 + MCP
// ============================================================

describe('13.9.1 Skill 工具可以来自任何来源', () => {
  it('allowed-tools 里声明的 MCP 工具会被挑进工具栈', () => {
    const registry = new SkillRegistry(SKILLS_DIR);
    registry.load();

    const { tools } = buildSkillToolSet(registry, {
      mcpTools: [
        { name: 'req_analyze_completeness' },
        { name: 'ws_search_best_practices' },
        { name: 'unrelated_tool' },
      ],
    });
    const names = tools.map((t) => t.name);

    expect(names).toContain('load_skill');
    expect(names).toContain('req_analyze_completeness');
    expect(names).toContain('ws_search_best_practices');
    // 没被任何 Skill 声明的工具不该混进来
    expect(names).not.toContain('unrelated_tool');
  });

  it('没有 MCP 工具时只装配本地工具', () => {
    const registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
    const { tools } = buildSkillToolSet(registry);
    const names = tools.map((t) => t.name);
    expect(names).toContain('load_skill');
    for (const n of SKILL_LOCAL_TOOL_NAMES) expect(names).toContain(n);
    expect(names.some((n) => n.startsWith('req_'))).toBe(false);
  });
});

// ============================================================
// 13.4.3 L1 索引注入（等价于 createMiddleware）
// ============================================================

describe('13.4.3 L1 索引注入与专家挂载', () => {
  let registry: SkillRegistry;

  beforeAll(() => {
    registry = new SkillRegistry(SKILLS_DIR);
    registry.load();
  });

  it('索引提示包含技能清单与 load_skill 用法', () => {
    const prompt = buildSkillIndexPrompt(registry);
    expect(prompt).toContain('## 可用技能');
    expect(prompt).toContain('requirement-analysis');
    expect(prompt).toContain('competitor-research');
    expect(prompt).toContain('load_skill');
  });

  it('空注册表不产生索引', () => {
    const empty = new SkillRegistry(join(SKILLS_DIR, '__not_exist__'));
    empty.load();
    expect(buildSkillIndexPrompt(empty)).toBe('');
  });

  it('buildSkillPromptAddendum：有则拼接，无则空串', () => {
    expect(buildSkillPromptAddendum({ indexPrompt: 'X' })).toBe('\n\nX');
    expect(buildSkillPromptAddendum(undefined)).toBe('');
    expect(buildSkillPromptAddendum({})).toBe('');
  });

  it('withSkillTools：挂载开关', () => {
    const base = [{ name: 'a' }];
    expect(withSkillTools(base, { tools: [{ name: 'load_skill' }] })).toHaveLength(2);
    expect(withSkillTools(base, undefined)).toBe(base);
    expect(withSkillTools(base, {})).toBe(base);
  });
});

// ============================================================
// 13.10.2 / 13.10.4 启动校验与可观测
// ============================================================

describe('13.10.2 启动期工具校验', () => {
  it('本地工具齐备即通过，缺失的 MCP 工具只报不拦', () => {
    const registry = new SkillRegistry(SKILLS_DIR);
    registry.load();

    const { tools } = buildSkillToolSet(registry);
    const report = registry.validateTools(tools.map((t) => t.name), {
      optionalTools: registry
        .collectDeclaredTools()
        .filter((n) => /^(req_|ws_)/.test(n)),
    });

    expect(report.ok).toBe(true);
    // req_* / ws_* 没接 MCP 时确实缺失，要能被报出来
    expect(report.missingCount).toBeGreaterThan(0);
    const req = report.skills.find((s) => s.skillName === 'requirement-analysis');
    expect(req?.missing).toContain('req_analyze_completeness');
    expect(req?.resolved).toContain('analyze_completeness');
  });
});

describe('13.10.4 Skills 可观测性', () => {
  it('summary 统计命中率与 token 量', () => {
    const collector = new SkillTraceCollector();
    collector.add({
      requestId: 'r1',
      skillName: 'requirement-analysis',
      skillVersion: '1.0.0',
      hit: true,
      loadDurationMs: 10,
      bodyLength: 3000,
      estimatedTokens: 1800,
      status: 'hit',
      startedAt: 1,
      endedAt: 11,
    });
    collector.add({
      requestId: 'r1',
      skillName: 'nope',
      hit: false,
      loadDurationMs: 2,
      bodyLength: 0,
      estimatedTokens: 0,
      status: 'missing',
      startedAt: 1,
      endedAt: 3,
    });

    const s = collector.summary();
    expect(s.totalLoads).toBe(2);
    expect(s.hitRate).toBe(0.5);
    expect(s.bySkill['requirement-analysis'].hits).toBe(1);
    expect(s.totalEstimatedTokens).toBe(1800);
    expect(summarizeSkillTraces([]).hitRate).toBe(0);
  });
});

// ============================================================
// 13.4 全链路装配
// ============================================================

describe('13.4 SkillRuntime 装配', () => {
  it('装配出 load_skill + 本地工具 + L1 索引', () => {
    const runtime = createSkillRuntime({ rootDir: SKILLS_DIR });
    expect(runtime).not.toBeNull();
    expect(runtime!.errors).toEqual([]);
    expect(runtime!.tools.map((t) => t.name)).toContain('load_skill');
    expect(runtime!.indexPrompt).toContain('requirement-analysis');
    expect(runtime!.report?.ok).toBe(true);
  });

  it('SKILLS_ENABLED=0 时返回 null，调用方保持原行为', () => {
    expect(createSkillRuntime({ rootDir: SKILLS_DIR, enabled: false })).toBeNull();
  });

  it('资产目录不存在时不抛异常，只记告警', () => {
    const runtime = createSkillRuntime({
      rootDir: join(SKILLS_DIR, '__not_exist__'),
      logger: () => {},
    });
    expect(runtime).not.toBeNull();
    expect(runtime!.errors.join()).toContain('不存在');
    // 工具栈里至少还要有 load_skill，否则 Agent 会失去入口
    expect(runtime!.tools.map((t) => t.name)).toContain('load_skill');
  });
});
