/**
 * services/chat/src/eval/dataset-loader.ts
 *
 * golden 数据集与评测语料加载器（第十七章 17.6）
 *
 * 数据集字段遵守「只放评测真正需要的」这条白名单原则 —— 每多一个字段，
 * 就多一处需要在样本演进时同步维护的地方，也更容易把标注者的主观偏好写进去。
 *
 * 与 autix 那版相比这里多了一层校验：`validateGroundTruth()`。
 * 数据集里的 relevantChunkIds 如果指向语料里不存在的 id，检索指标会**静默变成全 0**
 * （一条都命中不了），表现为「召回突然崩了」，实际是标注漂移。这种错误必须当场炸出来。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 评测专用 userId：灌库与检索评测共用，和真实用户数据彻底隔离。
 * 检索走 SearchService 时会按 userId 过滤，用它保证评测只看到 golden 语料。
 */
export const EVAL_USER_ID = 'eval-bot';

/** 与 IntentClassificationSchema 的枚举保持一致（analyze / query / chat） */
export type ExpectedIntent = 'analyze' | 'query' | 'chat';

const VALID_INTENTS: ExpectedIntent[] = ['analyze', 'query', 'chat'];

export interface EvalCase {
  id: string;
  input: string;
  expectedIntent: ExpectedIntent;
  /** 该 query 的相关文档（ground truth），评检索指标用；非 RAG case 可缺省 */
  relevantChunkIds?: string[];
  /** 标准答案，评 faithfulness 时作参照；可缺省 */
  groundTruthAnswer?: string;
  /** 分桶标签（typical / edge / compliance / query / smalltalk...） */
  tags: string[];
}

export interface CorpusChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
}

const DATASETS_DIR = fileURLToPath(new URL('./datasets/', import.meta.url));
const CORPUS_DIR = fileURLToPath(new URL('./corpus/', import.meta.url));

function loadJsonl<T>(filePath: string, label: string): T[] {
  const raw = readFileSync(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line, i) => {
      try {
        return JSON.parse(line) as T;
      } catch (err) {
        throw new Error(
          `${label} 第 ${i + 1} 行不是合法 JSON：${(err as Error).message}`,
        );
      }
    });
}

/**
 * 读取 golden 数据集（.jsonl，每行一个 case）。
 *
 * @param name 数据集文件名（不含扩展名）
 */
export function loadDataset(name = 'requirement-analysis'): EvalCase[] {
  const rows = loadJsonl<Partial<EvalCase>>(`${DATASETS_DIR}${name}.jsonl`, `数据集 ${name}`);

  return rows.map((obj, i) => {
    const lineNo = i + 1;
    if (!obj.id) throw new Error(`数据集 ${name} 第 ${lineNo} 行缺少 id`);
    if (!obj.input) throw new Error(`数据集 ${name} 第 ${lineNo} 行缺少 input`);
    if (!obj.expectedIntent) {
      throw new Error(`数据集 ${name} 第 ${lineNo} 行缺少 expectedIntent`);
    }
    if (!VALID_INTENTS.includes(obj.expectedIntent)) {
      throw new Error(
        `数据集 ${name} 第 ${lineNo} 行的 expectedIntent 非法：${obj.expectedIntent}（只能是 ${VALID_INTENTS.join(' / ')}）`,
      );
    }

    return {
      id: obj.id,
      input: obj.input,
      expectedIntent: obj.expectedIntent,
      relevantChunkIds: obj.relevantChunkIds,
      groundTruthAnswer: obj.groundTruthAnswer,
      tags: obj.tags ?? [],
    };
  });
}

/**
 * 读取评测语料（seed 脚本与检索评测共用，chunkId 稳定可对齐数据集的 relevantChunkIds）。
 *
 * chunkId 必须是可读的稳定值（如 c-auth-1）而不是 cuid ——
 * 检索指标靠 id 比对，自动生成的 id 每次灌库都变，数据集标注也就跟着失效。
 */
export function loadCorpus(name = 'requirement-kb'): CorpusChunk[] {
  const rows = loadJsonl<CorpusChunk>(`${CORPUS_DIR}${name}.jsonl`, `语料 ${name}`);

  rows.forEach((c, i) => {
    if (!c.chunkId || !c.documentId || !c.content) {
      throw new Error(`语料 ${name} 第 ${i + 1} 行缺少 chunkId / documentId / content`);
    }
  });

  const dup = rows.find((c, i) => rows.findIndex((x) => x.chunkId === c.chunkId) !== i);
  if (dup) throw new Error(`语料 ${name} 存在重复 chunkId：${dup.chunkId}`);

  return rows;
}

/**
 * 校验数据集的 relevantChunkIds 是否都真实存在于语料里。
 *
 * 这一条是防「标注漂移」的：数据集和语料是两个文件，改了语料的 chunkId
 * 却忘了同步数据集时，检索指标会静默归零，看起来像模型/RAG 退化了。
 *
 * @returns 问题描述数组，空数组表示全部通过
 */
export function validateGroundTruth(
  cases: EvalCase[],
  corpus: CorpusChunk[],
): string[] {
  const known = new Set(corpus.map((c) => c.chunkId));
  const problems: string[] = [];

  for (const c of cases) {
    for (const id of c.relevantChunkIds ?? []) {
      if (!known.has(id)) {
        problems.push(`case ${c.id} 引用了语料中不存在的 chunk「${id}」`);
      }
    }
  }

  return problems;
}
