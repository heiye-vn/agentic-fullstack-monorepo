/**
 * services/chat/mcp-servers/requirement-analyzer/src/analyzers.ts
 *
 * 第十二章 12.4 — 需求分析 MCP Server 的纯函数内核
 *
 * 这里刻意不依赖 MCP SDK：所有分析逻辑都是可单测的纯函数，
 * server.ts 只负责把它们注册成 MCP Tool。这样测试测的是真实实现，
 * 而不是像参考项目那样在 spec 里复制一份逻辑。
 */

export interface RequirementDimension {
  name: string;
  keywords: string[];
}

/** 12.4.1 完整性分析的六个维度 */
export const COMPLETENESS_DIMENSIONS: RequirementDimension[] = [
  {
    name: '用户角色',
    keywords: ['用户', '角色', '作为', 'PM', '开发', '管理员', '运营'],
  },
  {
    name: '功能描述',
    keywords: ['能够', '可以', '支持', '实现', '功能', '需要', '希望'],
  },
  {
    name: '验收标准',
    keywords: ['验收', '标准', '条件', '期望', '预期结果', '应该', '必须'],
  },
  {
    name: '优先级',
    keywords: ['优先', 'P0', 'P1', 'P2', '紧急', '重要', '高', '低'],
  },
  {
    name: '非功能需求',
    keywords: ['性能', '安全', '可用性', '并发', '响应时间', '可靠', '稳定'],
  },
  {
    name: '边界条件',
    keywords: ['边界', '异常', '限制', '最大', '最小', '超出', '错误', '失败'],
  },
];

export interface CompletenessResult {
  completenessScore: number;
  totalDimensions: number;
  coveredDimensions: string[];
  missingDimensions: string[];
  suggestion: string;
}

/**
 * 12.4.1 需求完整性分析
 *
 * 按维度关键词命中率打分：score = 命中维度数 / 总维度数 * 100
 */
export function analyzeCompleteness(requirementText: string): CompletenessResult {
  const text = requirementText ?? '';
  const covered: string[] = [];
  const missing: string[] = [];

  for (const dim of COMPLETENESS_DIMENSIONS) {
    if (dim.keywords.some((kw) => text.includes(kw))) {
      covered.push(dim.name);
    } else {
      missing.push(dim.name);
    }
  }

  const score = Math.round((covered.length / COMPLETENESS_DIMENSIONS.length) * 100);

  return {
    completenessScore: score,
    totalDimensions: COMPLETENESS_DIMENSIONS.length,
    coveredDimensions: covered,
    missingDimensions: missing,
    suggestion:
      missing.length > 0
        ? `建议补充以下维度：${missing.join('、')}`
        : '需求描述较为完整',
  };
}

/** 复杂度因子：正则 → 权重 → 说明 */
const COMPLEXITY_FACTORS: Array<{
  pattern: RegExp;
  score: number;
  label: string;
}> = [
  { pattern: /集成|对接|第三方|API|接口|外部/, score: 3, label: '涉及外部系统集成' },
  { pattern: /迁移|导入|导出|批量|同步|Excel|CSV/, score: 2, label: '涉及数据处理/迁移' },
  { pattern: /权限|角色|鉴权|审批|多租户/, score: 2, label: '涉及权限体系' },
  { pattern: /实时|推送|WebSocket|通知|消息/, score: 2, label: '涉及实时通信' },
  { pattern: /AI|智能|推荐|预测|模型|LLM/, score: 3, label: '涉及 AI/ML 能力' },
  { pattern: /加密|安全|合规|审计/, score: 1, label: '有安全合规要求' },
];

export type ComplexitySize = 'S' | 'M' | 'L' | 'XL';

export interface ComplexityResult {
  size: ComplexitySize;
  estimatedDays: string;
  complexityScore: number;
  factors: string[];
  suggestion: string;
}

const SIZE_TO_DAYS: Record<ComplexitySize, string> = {
  S: '1-3天',
  M: '3-7天',
  L: '1-3周',
  XL: '3周以上',
};

/**
 * 12.4.2 复杂度估算（T-shirt size）
 *
 * 阈值：<=2 S / <=4 M / <=6 L / 其余 XL
 */
export function estimateComplexity(
  requirementText: string,
  techStack?: string,
): ComplexityResult {
  const text = `${requirementText ?? ''}${techStack ? ` ${techStack}` : ''}`;
  let score = 0;
  const factors: string[] = [];

  for (const factor of COMPLEXITY_FACTORS) {
    if (factor.pattern.test(text)) {
      score += factor.score;
      factors.push(factor.label);
    }
  }

  if ((requirementText ?? '').length > 500) {
    score += 1;
    factors.push('需求描述较长，可能涉及多个子功能');
  }

  const size: ComplexitySize =
    score <= 2 ? 'S' : score <= 4 ? 'M' : score <= 6 ? 'L' : 'XL';
  const estimatedDays = SIZE_TO_DAYS[size];

  return {
    size,
    estimatedDays,
    complexityScore: score,
    factors: factors.length > 0 ? factors : ['需求相对简单，无明显复杂因素'],
    suggestion:
      size === 'XL'
        ? '建议拆分为多个子需求分批交付'
        : `复杂度适中，预计 ${estimatedDays} 可完成`,
  };
}

export interface ExistingRequirement {
  id: string;
  title: string;
  description: string;
}

export interface ConflictItem {
  id: string;
  title: string;
  type: string;
  detail: string;
}

export interface ConflictResult {
  hasConflicts: boolean;
  conflictCount: number;
  conflicts: ConflictItem[];
  suggestion: string;
}

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些', '什么',
  '可以', '需要', '能够', '支持', '实现', '进行', '通过', '使用',
]);

/** 去标点 → 切词 → 去停用词，长度 >= 2 才保留 */
export function extractKeywords(text: string): string[] {
  return (text ?? '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * 12.4.3 需求冲突检查
 *
 * 两条需求共同关键词 >= minOverlap（默认 3）时判定为「功能重叠」
 */
export function checkConflicts(
  newRequirement: string,
  existingRequirements: ExistingRequirement[],
  minOverlap = 3,
): ConflictResult {
  const newKeywords = extractKeywords(newRequirement);
  const conflicts: ConflictItem[] = [];

  for (const existing of existingRequirements ?? []) {
    const existingKeywords = extractKeywords(existing.description ?? '');
    const overlap = newKeywords.filter((k) => existingKeywords.includes(k));

    if (overlap.length >= minOverlap) {
      conflicts.push({
        id: existing.id,
        title: existing.title,
        type: '功能重叠',
        detail: `共同关键词：${overlap.join('、')}`,
      });
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts,
    suggestion:
      conflicts.length > 0
        ? `发现 ${conflicts.length} 个潜在冲突，建议与相关需求负责人确认`
        : '未发现与现有需求的明显冲突',
  };
}

export interface UserStory {
  id: string;
  story: string;
  acceptanceCriteria: string[];
  priority: string;
}

export interface UserStoryResult {
  stories: UserStory[];
  note: string;
}

/** 从「作为X，」「管理员|用户|...」中抽取角色 */
export function extractActors(text: string): string[] {
  const patterns = [/作为(.{2,6})[，,]/g, /(管理员|用户|开发者|产品经理|运营|客服|审核员)/g];
  const actors: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text ?? '')) !== null) {
      actors.push(match[1]);
    }
  }
  return [...new Set(actors)];
}

/** 从「能够X，」「可以X。」等句式里抽取动作 */
export function extractActions(text: string): string[] {
  const patterns = [
    /能够(.{5,30})[，。,.\s]/g,
    /可以(.{5,30})[，。,.\s]/g,
    /支持(.{5,30})[，。,.\s]/g,
    /希望(.{5,30})[，。,.\s]/g,
  ];
  const actions: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text ?? '')) !== null) {
      actions.push(match[1]);
    }
  }
  return [...new Set(actions)];
}

/**
 * 12.4.4 用户故事生成
 *
 * 角色数决定故事条数上限（至少 1 条），再按 maxStories 截断
 */
export function generateUserStories(
  requirementText: string,
  maxStories = 3,
): UserStoryResult {
  const actors = extractActors(requirementText);
  const actions = extractActions(requirementText);
  const count = Math.min(maxStories, Math.max(actors.length, 1));
  const stories: UserStory[] = [];

  for (let i = 0; i < count; i++) {
    const actor = actors[i] || '用户';
    const action = actions[i] || (requirementText ?? '').substring(0, 50);
    stories.push({
      id: `US-${String(i + 1).padStart(3, '0')}`,
      story: `作为${actor}，我希望能够${action}，以便提高工作效率`,
      acceptanceCriteria: [
        '功能可在主界面直接访问',
        '操作响应时间 < 2 秒',
        '异常情况有明确的错误提示',
      ],
      priority: i === 0 ? 'P1' : 'P2',
    });
  }

  return {
    stories,
    note: '基于需求描述自动生成，请根据实际业务场景调整验收标准和优先级',
  };
}
