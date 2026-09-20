/**
 * src/skills/skill-tools.ts
 *
 * 第十三章 13.8.4 — Skill 自带的本地工具（TypeScript 实现）
 *
 * 和参考项目的第一个不同：这里**不用 Python**。
 * 参考项目用 `execSync('python3 …')` 调脚本，在 Windows 上直接跑不起来，
 * 而且 execSync 同步阻塞事件循环、没有超时、没有错误兜底。
 * 本地工具本来就是确定性逻辑，直接写成纯函数更好测、更好控。
 *
 * 第二个不同：工具逻辑与 SKILL.md 解耦。
 * SKILL.md 只声明 `allowed-tools` 的名字，真正实现在这里 —— 这就是
 * 教程 13.9.1 说的"工具名是公共契约，实现可以来自任何来源"。
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

// ============================================================
// 1. 需求完整性检查
// ============================================================

interface Dimension {
  key: string;
  label: string;
  keywords: string[];
}

/** 六维度模型：与 SKILL.md 正文里声明的维度严格一致 */
const COMPLETENESS_DIMENSIONS: Dimension[] = [
  {
    key: 'userRole',
    label: '用户角色',
    keywords: ['作为', '管理员', '用户', '运营', '角色', '权限', '会员', '客户'],
  },
  {
    key: 'functionalDesc',
    label: '功能描述',
    keywords: ['需要', '能够', '支持', '可以', '实现', '提供', '允许', '功能'],
  },
  {
    key: 'acceptance',
    label: '验收标准',
    keywords: ['验收', '标准', '通过', '成功', '失败', '提示', '校验', '预期'],
  },
  {
    key: 'priority',
    label: '优先级',
    keywords: ['优先', '紧急', 'P0', 'P1', 'P2', '必须', '重要', '上线时间'],
  },
  {
    key: 'nonFunctional',
    label: '非功能需求',
    keywords: ['性能', '并发', '响应', '安全', '容量', 'qps', 'QPS', '可用', '稳定'],
  },
  {
    key: 'boundary',
    label: '边界条件',
    keywords: ['异常', '边界', '上限', '限制', '超限', '失败', '重试', '空', '去重'],
  },
];

export interface CompletenessResult {
  completenessScore: number;
  coveredDimensions: string[];
  missingDimensions: string[];
  dimensionDetails: Array<{ dimension: string; covered: boolean; hits: string[] }>;
  suggestion: string;
}

export function analyzeRequirementCompleteness(
  requirementText: string,
): CompletenessResult {
  const text = requirementText ?? '';
  const lower = text.toLowerCase();

  const dimensionDetails = COMPLETENESS_DIMENSIONS.map((dim) => {
    const hits = dim.keywords.filter((k) => lower.includes(k.toLowerCase()));
    return {
      dimension: dim.label,
      covered: hits.length > 0,
      hits: [...new Set(hits)],
    };
  });

  const covered = dimensionDetails.filter((d) => d.covered).map((d) => d.dimension);
  const missing = dimensionDetails.filter((d) => !d.covered).map((d) => d.dimension);

  return {
    completenessScore: Math.round((covered.length / COMPLETENESS_DIMENSIONS.length) * 100),
    coveredDimensions: covered,
    missingDimensions: missing,
    dimensionDetails,
    suggestion: missing.length
      ? `建议补充：${missing.join('、')}`
      : '六个维度均已覆盖，可以进入复杂度估算',
  };
}

// ============================================================
// 2. 复杂度估算
// ============================================================

interface ComplexityFactor {
  label: string;
  keywords: string[];
  /** 权重，累加后决定 T-shirt size */
  weight: number;
}

const COMPLEXITY_FACTORS: ComplexityFactor[] = [
  { label: '批量处理（导入/导出/批处理）', keywords: ['批量', '导入', '导出', '批处理', '同步'], weight: 1 },
  { label: '第三方系统集成', keywords: ['第三方', 'api', '集成', '对接', 'webhook', '回调'], weight: 1 },
  { label: '文件解析（CSV/Excel/PDF）', keywords: ['csv', 'excel', 'pdf', '解析', '文件'], weight: 1 },
  { label: '权限与角色控制', keywords: ['权限', '角色', 'rbac', '鉴权', '越权'], weight: 0.5 },
  { label: '审批流 / 状态机', keywords: ['审批', '流程', '状态机', '流转', '工单'], weight: 1 },
  { label: '高并发或实时性要求', keywords: ['并发', '实时', '推送', 'qps', '毫秒', '秒级'], weight: 2 },
  { label: '搜索或算法能力', keywords: ['搜索', '推荐', '排序', '算法', '匹配', '检索'], weight: 2 },
  { label: '数据统计与报表', keywords: ['统计', '报表', '看板', '指标', 'dashboard'], weight: 0.5 },
  { label: '数据迁移与去重', keywords: ['迁移', '去重', '清洗', '历史数据'], weight: 1 },
];

const SIZE_DAYS: Record<string, { min: number; max: number }> = {
  S: { min: 2, max: 5 },
  M: { min: 8, max: 15 },
  L: { min: 18, max: 30 },
  XL: { min: 35, max: 60 },
};

export interface ComplexityResult {
  size: 'S' | 'M' | 'L' | 'XL';
  factors: string[];
  estimatedDays: number;
  dayRange: { min: number; max: number };
  basis: string;
}

export function estimateRequirementComplexity(
  requirementText: string,
): ComplexityResult {
  const lower = (requirementText ?? '').toLowerCase();
  const factors = COMPLEXITY_FACTORS.filter((f) =>
    f.keywords.some((k) => lower.includes(k.toLowerCase())),
  );

  const score = factors.reduce((sum, f) => sum + f.weight, 0);
  const size: ComplexityResult['size'] =
    score >= 5 ? 'XL' : score >= 3 ? 'L' : score >= 1.5 ? 'M' : 'S';
  const range = SIZE_DAYS[size];

  return {
    size,
    factors: factors.map((f) => f.label),
    estimatedDays: Math.round((range.min + range.max) / 2),
    dayRange: range,
    basis:
      factors.length > 0
        ? `命中 ${factors.length} 个复杂度因子，累计权重 ${score}`
        : '未命中任何复杂度因子，按最小实现估算',
  };
}

// ============================================================
// 3. 竞品检索（本地竞品库）
// ============================================================

interface Competitor {
  name: string;
  positioning: string;
  pricing: string;
  targetUsers: string;
  tags: string[];
}

const COMPETITOR_LIBRARY: Competitor[] = [
  {
    name: 'Trello',
    positioning: '看板式轻量协作，上手成本极低',
    pricing: '免费版 + 约 $5/人/月起',
    targetUsers: '小团队、个人、非技术团队',
    tags: ['项目管理', '看板', '协作', '轻量', '中小团队'],
  },
  {
    name: 'Asana',
    positioning: '任务与项目进度管理，强调跨部门协同',
    pricing: '免费版 + 约 $10.99/人/月起',
    targetUsers: '中小型团队、市场与运营团队',
    tags: ['项目管理', '任务', '协作', '进度', '中小团队'],
  },
  {
    name: 'Jira',
    positioning: '研发全流程管理，可与代码仓库深度集成',
    pricing: '免费版 + 约 $7.5/人/月起',
    targetUsers: '研发团队、中大型企业',
    tags: ['项目管理', '研发', '敏捷', '缺陷', '企业'],
  },
  {
    name: 'Notion',
    positioning: '文档 + 数据库 + 项目的一体化工作区',
    pricing: '免费版 + 约 $8/人/月起',
    targetUsers: '知识型团队、初创公司',
    tags: ['文档', '协作', '知识库', '项目管理', '轻量'],
  },
  {
    name: '飞书项目',
    positioning: '本土化研发项目管理，与 IM 办公套件打通',
    pricing: '按版本与人数阶梯计费',
    targetUsers: '国内企业、研发团队',
    tags: ['项目管理', '研发', '协作', '国内', '企业'],
  },
  {
    name: 'Airtable',
    positioning: '表格形态的灵活数据库，可搭建轻量业务系统',
    pricing: '免费版 + 约 $10/人/月起',
    targetUsers: '业务团队、运营、非技术搭建者',
    tags: ['表格', '数据库', '低代码', '业务系统'],
  },
  {
    name: 'Power BI',
    positioning: '企业级 BI 报表与数据可视化',
    pricing: '约 $10/人/月起',
    targetUsers: '数据分析团队、中大型企业',
    tags: ['报表', 'bi', '可视化', '数据', '企业'],
  },
  {
    name: 'Metabase',
    positioning: '开源轻量 BI，自助式查询与看板',
    pricing: '开源免费 + 企业版付费',
    targetUsers: '中小团队、有自托管诉求的团队',
    tags: ['报表', 'bi', '可视化', '开源', '自托管'],
  },
];

export interface CompetitorResult {
  query: string;
  results: Array<Omit<Competitor, 'tags'> & { matchScore: number }>;
  note: string;
}

export function searchCompetitors(query: string, limit = 4): CompetitorResult {
  const q = (query ?? '').trim();
  const terms = q
    .split(/[\s,，、/]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);

  const scored = COMPETITOR_LIBRARY.map((c) => {
    const haystack = `${c.name} ${c.positioning} ${c.targetUsers} ${c.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (c.tags.some((tag) => tag.toLowerCase() === t)) score += 3;
      // 双向包含：query 比标签长（"项目管理工具" vs 标签"项目管理"）时也要命中
      else if (
        c.tags.some(
          (tag) => tag.toLowerCase().includes(t) || t.includes(tag.toLowerCase()),
        )
      )
        score += 2;
      else if (haystack.includes(t)) score += 1;
    }
    return { ...c, matchScore: score };
  })
    .filter((c) => c.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore);

  const picked = scored.slice(0, limit);

  return {
    query: q,
    results: picked.map((c) => ({
      name: c.name,
      positioning: c.positioning,
      pricing: c.pricing,
      targetUsers: c.targetUsers,
      matchScore: c.matchScore,
    })),
    note:
      picked.length > 0
        ? `本地竞品库命中 ${picked.length} 条（来源：内置库，非实时数据）`
        : '本地竞品库未命中，请调整关键词或改用外部检索工具',
  };
}

// ============================================================
// 4. 行业最佳实践检索
// ============================================================

interface BestPractice {
  title: string;
  detail: string;
  tags: string[];
}

const BEST_PRACTICE_LIBRARY: BestPractice[] = [
  {
    title: '批量导入先校验后落库',
    detail: '先在内存/临时表完成格式与业务校验，生成错误报告让用户下载修正，再整批落库；避免半成功状态。',
    tags: ['批量', '导入', '去重', '数据'],
  },
  {
    title: '导入任务异步化 + 进度可查',
    detail: '超过千行的导入走异步任务，提供 taskId 与进度查询接口，并在完成后推送通知。',
    tags: ['批量', '导入', '异步', '性能'],
  },
  {
    title: '去重键要显式声明',
    detail: '明确唯一键（手机号/邮箱/外部 ID 组合），并在冲突时给出覆盖、跳过、报错三种可选策略。',
    tags: ['去重', '数据', '导入'],
  },
  {
    title: '权限模型按资源而非按页面',
    detail: 'RBAC 之外补充资源级校验（谁能看哪条数据），页面隐藏不等于接口安全。',
    tags: ['权限', '安全', '角色', '鉴权'],
  },
  {
    title: '第三方集成必须带超时与重试',
    detail: '外部 API 调用设置连接/读超时、指数退避重试与熔断，失败要可观测。',
    tags: ['第三方', '集成', 'api', '稳定性'],
  },
  {
    title: '关键操作留审计日志',
    detail: '导入、删除、权限变更等写操作记录操作人、时间、影响范围，满足合规与事后追溯。',
    tags: ['合规', '审计', '安全', '数据'],
  },
  {
    title: '大文件解析限制体积与行数',
    detail: '限制单文件大小与行数，超限时提示分片；解析失败要能定位到具体行号。',
    tags: ['文件', '解析', 'csv', 'excel', '性能'],
  },
  {
    title: '报表类需求先定义口径',
    detail: '指标口径、统计周期、去重规则先对齐再开发，口径不清是报表返工的第一来源。',
    tags: ['报表', 'bi', '统计', '数据'],
  },
];

export interface BestPracticeResult {
  topic: string;
  practices: Array<{ title: string; detail: string }>;
  note: string;
}

export function searchBestPractices(topic: string, limit = 4): BestPracticeResult {
  const t = (topic ?? '').trim();
  const terms = t
    .split(/[\s,，、/]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  const scored = BEST_PRACTICE_LIBRARY.map((p) => {
    const haystack = `${p.title} ${p.detail} ${p.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (p.tags.some((tag) => tag.toLowerCase() === term)) score += 3;
      else if (
        p.tags.some(
          (tag) =>
            tag.toLowerCase().includes(term) || term.includes(tag.toLowerCase()),
        )
      )
        score += 2;
      else if (haystack.includes(term)) score += 1;
    }
    return { ...p, score };
  })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  // 一个都没命中时给通用工程实践，避免 Agent 拿到空结果就自由发挥
  const fallback: BestPractice[] = [
    {
      title: '先明确验收标准再开发',
      detail: '把"什么叫做完"写成可测试的条件，是需求返工率最低的干预点。',
      tags: [],
    },
    {
      title: '关键路径要有降级方案',
      detail: '对外依赖、计算密集型步骤都要有失败时的替代路径，避免单点阻塞主流程。',
      tags: [],
    },
  ];

  const picked = (scored.length > 0 ? scored : fallback).slice(0, limit);

  return {
    topic: t,
    practices: picked.map(({ title, detail }) => ({ title, detail })),
    note:
      scored.length > 0
        ? `命中 ${picked.length} 条本地最佳实践`
        : '未命中特定主题，返回通用工程实践',
  };
}

// ============================================================
// 5. LangChain 工具包装
// ============================================================

/** 本地 Skill 工具名，供启动时校验 allowed-tools 是否齐备 */
export const SKILL_LOCAL_TOOL_NAMES = [
  'analyze_completeness',
  'estimate_complexity',
  'search_competitors',
  'search_best_practices',
] as const;

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * 构造 4 个本地 Skill 工具
 *
 * 入参 schema 就是工具契约：Agent 靠 description + schema 决定怎么调，
 * 所以 description 要写清"什么时候用"，schema 的 describe 要写清"传什么"。
 */
export function createSkillTools(): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'analyze_completeness',
      description:
        '分析需求描述的完整性，从用户角色、功能描述、验收标准、优先级、非功能需求、边界条件六个维度检查是否缺少关键信息，返回评分与缺失维度。做需求分析时第一步调用它。',
      schema: z.object({
        requirementText: z.string().describe('用户的原始需求描述文本'),
      }),
      func: async ({ requirementText }) =>
        jsonText(analyzeRequirementCompleteness(requirementText)),
    }),
    new DynamicStructuredTool({
      name: 'estimate_complexity',
      description:
        '估算需求的技术复杂度，返回 T-shirt size（S/M/L/XL）、命中的复杂度因子与工期区间。',
      schema: z.object({
        requirementText: z.string().describe('用户的原始需求描述文本'),
      }),
      func: async ({ requirementText }) =>
        jsonText(estimateRequirementComplexity(requirementText)),
    }),
    new DynamicStructuredTool({
      name: 'search_competitors',
      description:
        '在本地竞品库中检索竞品，返回竞品名称、定位、定价、目标用户。做竞品调研时第一步调用它。',
      schema: z.object({
        query: z.string().describe('产品类型或功能领域关键词，如"项目管理工具"'),
      }),
      func: async ({ query }) => jsonText(searchCompetitors(query)),
    }),
    new DynamicStructuredTool({
      name: 'search_best_practices',
      description: '检索该领域的行业最佳实践与常见陷阱，返回可执行的实践清单。',
      schema: z.object({
        topic: z.string().describe('主题关键词，如"批量导入"'),
      }),
      func: async ({ topic }) => jsonText(searchBestPractices(topic)),
    }),
  ];
}
