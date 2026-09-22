/**
 * services/chat/src/eval/rubric-loader.ts
 *
 * 评分 rubric 加载器（第十七章 17.5.1）
 *
 * 把评分标准从 prompt 里抽出来外置成 yaml，让在线 criticNode 与离线 judge
 * 读同一份来源 —— 标准写死在两处代码里时，改一次迟早忘记改另一处。
 *
 * 路径解析用 `new URL('./rubrics/', import.meta.url)`：
 * 基于本文件自身位置定位，因此 tsx 脚本（从 src 跑）和 nest 产物（从 dist 跑）
 * 都能找到 yaml —— 前提是 nest-cli.json 的 assets 把 rubrics 拷进了 dist，
 * 第十三章 Skills 的 md 资产就是同一套机制，这里照做。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

export interface RubricDimension {
  id: string;
  name: string;
  /** 权重；同一份 rubric 内所有 dimension 的 weight 之和必须等于 1 */
  weight: number;
  desc: string;
}

/** 在线 criticNode 的检查项。注意它没有 weight —— 在线评审只要二值结论 */
export interface RubricCheckItem {
  id: string;
  name: string;
  desc: string;
}

export interface Rubric {
  version: number;
  dimensions: RubricDimension[];
  criticChecklist: RubricCheckItem[];
  gate: {
    minScore: number;
    minPerDimension: number;
  };
}

const RUBRICS_DIR = fileURLToPath(new URL('./rubrics/', import.meta.url));

/** rubric 内容不会在一次进程里变化，缓存避免每个 case 都读一次盘 */
const cache = new Map<string, Rubric>();

/**
 * 校验并加载 rubric。
 *
 * 这里刻意「严格」：结构不完整、权重不等于 1，一律直接抛错而不是给默认值。
 * 评测标准的错误必须响亮地暴露 —— 静默兜底会让一轮评测在错误标准下跑完，
 * 产出的分数看起来是正常的，危害远大于启动失败。
 */
export function loadRubric(rubricId = 'requirement-analysis'): Rubric {
  const cached = cache.get(rubricId);
  if (cached) return cached;

  const raw = readFileSync(`${RUBRICS_DIR}${rubricId}.yaml`, 'utf-8');
  const parsed = load(raw) as Partial<Rubric> | null | undefined;

  if (!parsed || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
    throw new Error(`rubric ${rubricId} 结构非法：缺少 dimensions`);
  }
  if (!parsed.gate) {
    throw new Error(`rubric ${rubricId} 结构非法：缺少 gate（minScore / minPerDimension）`);
  }

  const weightSum = parsed.dimensions.reduce((s, d) => s + (d.weight ?? 0), 0);
  // 浮点比较必须留容差：0.3 + 0.25 + 0.25 + 0.2 在 IEEE754 下不等于精确的 1
  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new Error(`rubric ${rubricId} 权重之和必须为 1，当前为 ${weightSum}`);
  }

  const rubric: Rubric = {
    version: parsed.version ?? 0,
    dimensions: parsed.dimensions,
    criticChecklist: parsed.criticChecklist ?? [],
    gate: parsed.gate,
  };

  cache.set(rubricId, rubric);
  return rubric;
}

/**
 * 把 criticChecklist 组装成 criticNode 的 system prompt 片段。
 *
 * 之所以不直接返回整个 system prompt：criticNode 的输出格式要求（pass/critique/issues）
 * 属于图契约，应由图自己持有，这里只提供「评审标准」这一段。
 *
 * @returns 拼好的检查项文本；rubric 里没有 criticChecklist 时返回 null，
 *          调用方应据此回落到自己的内联标准（保证 rubric 文件缺失不影响主链路）
 */
export function buildCriticChecklistPrompt(rubricId = 'requirement-analysis'): string | null {
  let rubric: Rubric;
  try {
    rubric = loadRubric(rubricId);
  } catch {
    return null;
  }

  if (rubric.criticChecklist.length === 0) return null;

  const items = rubric.criticChecklist
    .map((item, i) => `${i + 1}. ${item.name}：${item.desc}`)
    .join('\n');

  return `**评审标准**（由 rubric v${rubric.version} 提供，必须全部满足）：\n${items}`;
}

/** 测试用：清掉缓存，保证改了 yaml 后能重新读到 */
export function clearRubricCache(): void {
  cache.clear();
}
