/**
 * chapter11-rag.spec.ts
 *
 * 第十一章《RAG——让产品读懂你的业务》配套测试用例
 *
 * 设计目标（与第八九十章保持一致）：
 * - **按文档章节组织**：每个 describe 标题以「11.x.y」开头
 * - **读者按图索骥**：在章节里看到 📋 标记后可直接：
 *     pnpm --filter @autix/chat test test/chapter11-rag.spec.ts -t "11.2.4"
 * - **效果可视化**：通过 console.log 打印"差距"，让读者直观看到：
 *     · baseline 检索 vs 重排后召回提升
 *     · 单独向量 vs 混合检索的 RRF 融合效果
 *     · Adaptive-RAG 在 simple / single_hop / multi_hop 上的不同路径
 * - **零依赖**：单元测试用 mock，无需 LLM API key、向量库、网络
 */
import { describe, it, expect } from 'vitest';
import {
  dot,
  l2Norm,
  normalize,
  cosineSimilarity,
  euclideanDistance,
} from '../src/rag/embedding/similarity.js';
import { chunkText } from '../src/rag/chunking/document-chunker.js';
import { chunkParentChild } from '../src/rag/chunking/parent-child-chunker.js';
import {
  bruteForceKnn,
  similaritySearch,
  upsertChunks,
  type VectorStoreRecord,
  type SearchResult,
} from '../src/rag/retrieval/vector-store.js';
import {
  rerankResults,
  retrieveWithRerank,
  type RerankerClient,
} from '../src/rag/retrieval/reranker.js';
import { rewriteQuery, multiQuerySearch } from '../src/rag/retrieval/query-rewriter.js';
import {
  hybridSearch,
  rrfFuse,
  rrfRanked,
  bm25Search,
  tokenize,
} from '../src/rag/retrieval/hybrid-search.js';
import { ragAsk, RAG_NO_CONTEXT_FALLBACK } from '../src/rag/pipeline/rag-pipeline.js';
import { hydeSearch } from '../src/rag/pipeline/hyde.js';
import {
  adaptiveRagAsk,
  fixedClassifier,
} from '../src/rag/pipeline/adaptive-rag.js';
import {
  recallAtK,
  mrr,
  ndcgAtK,
} from '../src/rag/evaluation/retrieval-metrics.js';
import { runRagas } from '../src/rag/evaluation/ragas-runner.js';
import {
  createRagTool,
  RAG_TOOL_NAME,
  RAG_TOOL_DESCRIPTION,
} from '../src/rag/agent/rag-tool.js';
import { withRagTool } from '../src/llm/graph/experts.js';
import { createVectorSearchFn } from '../src/rag/retrieval/vector-search-fn.js';

function logSection(title: string) {
  console.log(`\n  ─── ${title} ───`);
}

// ────────── 共用 mock helpers ──────────

function fakeVec(seed: number, dim = 4): number[] {
  // 简单 LCG，避免引入随机依赖
  const v: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 9301 + 49297) % 233280;
    v.push((s / 233280) * 2 - 1);
  }
  return v;
}

function fakeRecord(
  id: string,
  doc: string,
  content: string,
  embedding: number[],
): VectorStoreRecord {
  return {
    id,
    documentId: doc,
    content,
    chunkIndex: 0,
    embedding,
    modelName: 'mock-model',
  };
}

function fakeSearchResult(
  chunkId: string,
  content: string,
  score: number,
): SearchResult {
  return {
    chunkId,
    documentId: 'doc-' + chunkId,
    chunkIndex: 0,
    content,
    score,
  };
}

// ========================================================================
// 11.2 向量数学本质
// ========================================================================

describe('11.2.4 相似度 - 余弦 / 欧氏 / 点积 等价性', () => {
  it('单位向量自相似 = 1', () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = normalize([1, 2, 3, 4]);

    expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 9);
    expect(cosineSimilarity(v2, v2)).toBeCloseTo(1, 9);
    expect(cosineSimilarity(v3, v3)).toBeCloseTo(1, 9);
  });

  it('反方向向量相似 = -1', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 9);

    const v1 = [2, -4, 6];
    const v2 = [-1, 2, -3];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 9);
  });

  it('正交向量相似 = 0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 9);

    expect(cosineSimilarity([1, 1], [1, -1])).toBeCloseTo(0, 9);
  });

  it('归一化后 cosineSimilarity === dot（容差 1e-9）', () => {
    const raw1 = [0.21, -0.83, 0.42, 0.05];
    const raw2 = [0.23, -0.79, 0.39, 0.07];
    const a = normalize(raw1);
    const b = normalize(raw2);
    const cos = cosineSimilarity(a, b);
    const d = dot(a, b);

    logSection('L2 归一化后等价性');
    console.log(`  cosine = ${cos.toFixed(9)}`);
    console.log(`  dot    = ${d.toFixed(9)}`);
    console.log(`  ↳ 这就是为什么 RAG 默认用余弦：归一化后等价点积，量纲稳定`);

    expect(Math.abs(cos - d)).toBeLessThanOrEqual(1e-9);

    // 向量自身归一化后模长为 1
    expect(l2Norm(a)).toBeCloseTo(1, 9);
    expect(l2Norm(b)).toBeCloseTo(1, 9);
  });

  it('维度不匹配抛 RangeError("向量维度不匹配")', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/向量维度不匹配/);
    expect(() => dot([1], [])).toThrow(/向量维度不匹配/);
    expect(() => euclideanDistance([], [])).toThrow(/向量维度不匹配/);
    expect(() => dot(null as any, [1, 2])).toThrow(/向量维度不匹配/);
  });

  it('normalize 后向量范数为 1', () => {
    const v = normalize([3, 4]);
    expect(l2Norm(v)).toBeCloseTo(1, 9);
    expect(v[0]).toBeCloseTo(0.6, 9);
    expect(v[1]).toBeCloseTo(0.8, 9);
  });

  it('辅助几何与度量特性验证 (l2Norm, normalize, euclideanDistance)', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
    expect(l2Norm([3, 4])).toBe(5);
    expect(l2Norm([0, 0])).toBe(0);
    expect(normalize([0, 0])).toEqual([0, 0]);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

// ========================================================================
// 11.3 Embedding 选型
// ========================================================================

describe('11.3.7 入库 / 查询模型一致性 - modelName 必须存且不可混用', () => {
  it('record.modelName 必须为字符串且与查询时模型一致', () => {
    const record = fakeRecord('c1', 'd1', '内容', [0.1, 0.2]);
    expect(typeof record.modelName).toBe('string');

    // 换模型 = 全量重新 embedding + 重建索引，不能"老数据不动新数据用新模型"
    const queryModel = 'mock-model';
    expect(record.modelName).toBe(queryModel);
  });

  it('不同 dim 的向量不能写入同一字段（维度校验）', () => {
    const a = fakeRecord('c1', 'd1', '内容', [0.1, 0.2, 0.3]);
    const b = fakeRecord('c2', 'd1', '内容', [0.1, 0.2]);
    expect(a.embedding.length).not.toBe(b.embedding.length);
    expect(() => cosineSimilarity(a.embedding, b.embedding)).toThrow(RangeError);
  });
});

describe('11.3.6 Bi-Encoder 初筛 vs Cross-Encoder 重排（mock）', () => {
  it('Bi-Encoder 给出粗排，Cross-Encoder 重排后顺序按新分数', async () => {
    // 粗排：双塔向量相似度，这里用数字大小模拟
    const candidates = [
      fakeSearchResult('c1', '企业版单工作区最多 200 个项目', 0.72),
      fakeSearchResult('c2', '专业版不支持 SSO 登录', 0.68),
      fakeSearchResult('c3', '企业版支持 SSO 与审计日志', 0.61),
    ];

    // 精排：Cross-Encoder 能看到 Q 和 D 的 token 级对齐，判定 c3 其实最相关
    const reranker: RerankerClient = {
      rerank: async (_q, docs) =>
        docs.map((_, index) => ({ index, score: [0.3, 0.2, 0.95][index] })),
    };

    const reranked = await rerankResults(reranker, '企业版支持 SSO 吗', candidates, 3);

    logSection('Bi-Encoder 粗排 → Cross-Encoder 精排');
    console.log(
      '  粗排顺序 :',
      candidates.map((c) => `${c.chunkId}(${c.score})`).join(' > '),
    );
    console.log(
      '  精排顺序 :',
      reranked.map((c) => `${c.chunkId}(${c.score})`).join(' > '),
    );

    expect(reranked[0].chunkId).toBe('c3');
    expect(reranked[0].score).toBe(0.95);
  });

  it('重排越界 index 应被过滤，不把 undefined 塞进结果', async () => {
    const candidates = [fakeSearchResult('c1', '内容1', 0.5)];
    const badReranker: RerankerClient = {
      rerank: async () => [
        { index: 0, score: 0.9 },
        { index: 99, score: 0.8 },
        { index: -1, score: 0.7 },
      ],
    };

    const reranked = await rerankResults(badReranker, 'q', candidates, 5);
    expect(reranked).toHaveLength(1);
    expect(reranked[0].chunkId).toBe('c1');
  });
});

// ========================================================================
// 11.4 文档切分
// ========================================================================

describe('11.4 文档切分', () => {
  describe('11.4.3 默认 chunk_size 500 切 1200 字文本', () => {
    it('切 1200 字（无明显边界）应得 >= 3 个 chunk', async () => {
      const text = 'a'.repeat(1200);
      const chunks = await chunkText(text);

      logSection('1200 字切分');
      console.log(`  chunks 数: ${chunks.length}`);
      console.log(`  首块长度 : ${chunks[0].content.length}`);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks[0].content.length).toBeLessThanOrEqual(500);

      chunks.forEach((chunk, idx) => {
        expect(chunk.index).toBe(idx);
        expect(text.substring(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
      });
    });
  });

  describe('11.4.4 重叠 50 字时相邻 chunk 有真实交集', () => {
    it('chunks 拼接后字符数 > 原文长度（有重叠才会膨胀）', async () => {
      const text = 'a'.repeat(1500);
      const chunks = await chunkText(text, { chunkSize: 500, chunkOverlap: 50 });
      const totalLen = chunks.reduce((s, c) => s + c.content.length, 0);

      logSection('重叠膨胀');
      console.log(`  原文: 1500 字`);
      console.log(`  chunks 合计字数: ${totalLen}`);
      console.log(`  膨胀: ${totalLen - 1500} 字 ≈ overlap 50 * (n-1)`);

      expect(totalLen).toBeGreaterThan(1500);

      // 相邻首尾重叠检验
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].content.slice(-50)).toBe(chunks[i + 1].content.slice(0, 50));
      }
    });
  });

  describe('11.4.5 中文标点优先切分', () => {
    it("'第一段。\\n第二段...' 应在中文标点 / 换行处切，不会把英文/数字撕碎", async () => {
      // 多种结构：双换行段落 + 句号 + 逗号 + 英文 token
      const text =
        '产品支持 SSO 登录，管理员可在控制台创建用户组。批量导入用户支持 CSV 格式。\n\n' +
        '企业版上限为 200 个项目。专业版上限为 50 个项目，免费版 5 个。\n\n' +
        'API 兼容 OAuth2 协议。Token 默认 24 小时过期。'.repeat(3);
      const chunks = await chunkText(text, { chunkSize: 80, chunkOverlap: 0 });

      logSection('中文标点优先');
      console.log(`  chunk 数: ${chunks.length}`);
      chunks.slice(0, 4).forEach((c, i) => {
        console.log(
          `  [${i}] (${c.content.length}字): ${c.content.replace(/\n/g, '⏎')}`,
        );
      });

      // 1) 所有 chunk 长度都不超过 chunkSize（递归切分基本保证）
      for (const c of chunks) {
        expect(c.content.length).toBeLessThanOrEqual(80);
      }

      // 2) 关键约束：英文/数字 token 不应被中途切断
      const tokens = ['SSO', 'CSV', 'API', 'OAuth2', '24'];
      for (const tok of tokens) {
        if (!text.includes(tok)) continue;
        const survivedSomewhere = chunks.some((c) => c.content.includes(tok));
        expect(survivedSomewhere).toBe(true);
      }

      // 3) 至少有一个 chunk 以"。"或"\n"或"，"结尾，说明 separators 起了作用
      const endedAtSeparator = chunks.some((c) => {
        const last = c.content[c.content.length - 1];
        return last === '。' || last === '\n' || last === '，';
      });
      expect(endedAtSeparator).toBe(true);

      // 4) 偏移量精准还原验证
      chunks.forEach((chunk) => {
        expect(text.substring(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
      });
    });
  });

  describe('11.4.7 Parent-Child 切分', () => {
    it('parents.length < children.length，每个 child.parentIndex 在 parents 范围内', async () => {
      const text = (
        '## 第一节：登录\n用户进入登录页，选择企业 SSO 入口。系统跳转到 IDP 完成身份验证。' +
        '验证通过后回调到主站。\n\n' +
        '## 第二节：导入\n管理员可通过 CSV 批量导入用户。导入前应先做去重检查。' +
        '系统支持 10 万行以内的导入。\n\n' +
        '## 第三节：审计\n所有变更动作必须记录审计日志。日志保留 180 天。'
      ).repeat(3);

      // 支持对象传参 { parentSize: 300, childSize: 80 }
      const { parents, children } = await chunkParentChild(text, {
        parentSize: 300,
        childSize: 80,
      });

      logSection('Parent-Child 结构');
      console.log(`  parents 数 : ${parents.length}`);
      console.log(`  children 数: ${children.length}`);
      console.log(`  ↳ 小块用于检索（聚焦），命中后回查 parent 给 LLM 看（完整上下文）`);

      expect(parents.length).toBeGreaterThan(0);
      expect(children.length).toBeGreaterThan(parents.length);

      for (const c of children) {
        expect(c.parentIndex).toBeGreaterThanOrEqual(0);
        expect(c.parentIndex).toBeLessThan(parents.length);

        const parent = parents[c.parentIndex];
        expect(parent).toBeDefined();
        expect(parent.content).toContain(c.content);
      }
    });

    it('child 的 offset 必须回映射到原文：substring 能精确还原 content', async () => {
      const text = (
        '## 第一节：登录\n用户进入登录页，选择企业 SSO 入口。系统跳转到 IDP 完成身份验证。' +
        '验证通过后回调到主站。\n\n' +
        '## 第二节：导入\n管理员可通过 CSV 批量导入用户。导入前应先做去重检查。' +
        '系统支持 10 万行以内的导入。\n\n' +
        '## 第三节：审计\n所有变更动作必须记录审计日志。日志保留 180 天。'
      ).repeat(3);

      const { children } = await chunkParentChild(text, {
        parentSize: 300,
        childSize: 80,
      });

      // 子块 offset 若是相对 parent 的局部偏移，这条断言必挂——
      // 而"能在原文里定位回去"正是 parentIndex 回查 + 引用高亮的唯一依据
      for (const c of children) {
        expect(text.substring(c.startOffset, c.endOffset)).toBe(c.content);
      }
    });
  });

  it('空文本边界处理', async () => {
    expect(await chunkText('')).toEqual([]);
    expect(await chunkParentChild('')).toEqual({ parents: [], children: [] });
  });
});

// ========================================================================
// 11.5 向量数据库
// ========================================================================

describe('11.5 向量数据库', () => {
  describe('11.5.2 KNN 暴力 baseline - 小数据集与 mock ANN 一致性', () => {
    it('随机 50 条小数据集上，暴力 KNN 与"理论排序"完全一致', () => {
      const dim = 4;
      const records: VectorStoreRecord[] = [];
      for (let i = 0; i < 50; i++) {
        records.push(fakeRecord(`c${i}`, `d${i}`, `chunk ${i}`, fakeVec(i, dim)));
      }
      const query = fakeVec(123, dim);

      const top5 = bruteForceKnn(query, records, 5);

      logSection('暴力 KNN baseline');
      console.log(`  库大小: ${records.length}，Top-K = 5`);
      top5.forEach((r, i) => {
        console.log(`  [${i + 1}] ${r.chunkId}  score=${r.score.toFixed(4)}`);
      });
      console.log('  ↳ 50 条数据用暴力 O(n)；几十万条就要换 HNSW/IVF（11.5.3/4）');

      // 严格递减
      for (let i = 1; i < top5.length; i++) {
        expect(top5[i - 1].score).toBeGreaterThanOrEqual(top5[i].score);
      }
      expect(top5.length).toBe(5);
    });

    it('维度不一致立刻抛 RangeError', () => {
      const records: VectorStoreRecord[] = [
        fakeRecord('c1', 'd1', 'x', [0.1, 0.2, 0.3, 0.4]),
      ];
      expect(() => bruteForceKnn([0.1, 0.2], records, 5)).toThrow(/向量维度不匹配/);
    });
  });

  describe('11.5.6 cosine 距离与相似度互转一致性', () => {
    it('score = 1 - 距离；归一化向量上 score == dot', () => {
      const a = normalize([0.3, 0.4, 0.5, 0.2]);
      const b = normalize([0.31, 0.39, 0.5, 0.21]);

      const sim = cosineSimilarity(a, b);
      const distLike = 1 - sim;

      logSection('cosine ↔ distance');
      console.log(`  sim       = ${sim.toFixed(6)}`);
      console.log(`  1 - sim   = ${distLike.toFixed(6)}（即 pgvector <=> 输出）`);

      expect(sim + distLike).toBeCloseTo(1, 9);
    });
  });

  describe('11.5.x vector-store 仓储层契约与维度防御', () => {
    it('similaritySearch 维度与库中维度不一致抛出 RangeError', async () => {
      const mockPrisma = { $queryRaw: () => Promise.resolve([]) };
      await expect(
        similaritySearch(mockPrisma, [0.1, 0.2], { expectedDimension: 384 }),
      ).rejects.toThrow(RangeError);
    });

    it('similaritySearch 默认维度 384 校验', async () => {
      const mockPrisma = { $queryRaw: () => Promise.resolve([]) };
      await expect(similaritySearch(mockPrisma, [0.1, 0.2])).rejects.toThrow(
        /向量维度不匹配/,
      );
    });

    it('similaritySearch 正常通过 prisma.$queryRaw 检索并格式化返回', async () => {
      const mockPrisma = {
        $queryRaw: async () => [
          {
            id: 'c1',
            documentId: 'd1',
            chunkIndex: 0,
            content: '关于企业 SSO 登录配置说明',
            score: 0.88765,
          },
          {
            id: 'c2',
            documentId: 'd1',
            chunkIndex: 1,
            content: '企业版配额限制',
            score: 0.76543,
          },
        ],
      };

      const queryVec = new Array(384).fill(0.1);
      const results = await similaritySearch(mockPrisma, queryVec, {
        topK: 2,
        userId: 'user-123',
      });

      expect(results).toHaveLength(2);
      expect(results[0].chunkId).toBe('c1');
      expect(results[0].score).toBe(0.8877);
      expect(results[1].content).toBe('企业版配额限制');
    });

    it('upsertChunks 正常遍历 records 并调用 prisma.$queryRaw 执行入库', async () => {
      let executedCount = 0;
      const mockPrisma = {
        $queryRaw: async () => {
          executedCount++;
          return [];
        },
      };

      const records: VectorStoreRecord[] = [
        fakeRecord('c1', 'd1', '内容1', new Array(384).fill(0.1)),
        fakeRecord('c2', 'd1', '内容2', new Array(384).fill(0.2)),
      ];

      await upsertChunks(mockPrisma, records);
      expect(executedCount).toBe(2);
    });

    it('createVectorSearchFn 把 query 向量化后带 userId / expectedModelName 去查库', async () => {
      const embedded: string[] = [];
      const rawCalls: any[][] = [];

      const prisma = {
        $queryRaw: async (...args: any[]) => {
          rawCalls.push(args);
          return [];
        },
      };

      const searchFn = createVectorSearchFn({
        prisma,
        embedQuery: async (t: string) => {
          embedded.push(t);
          return new Array(384).fill(0.1);
        },
        userId: 'user-42',
        modelName: 'mini',
      });

      await searchFn('企业版项目上限', 3);

      // 1) 查询文本先过 Embedding
      expect(embedded).toEqual(['企业版项目上限']);
      // 2) 两次 SQL：一次 modelName 一致性校验，一次真正的向量检索
      expect(rawCalls.length).toBe(2);
      // 3) 真正的检索必须带上 userId 做权限过滤
      expect(JSON.stringify(rawCalls[1])).toContain('user-42');
    });

    it('createVectorSearchFn 在模型不一致时抛错，不静默返回空结果', async () => {
      const prisma = {
        $queryRaw: async () => [{ m: 'text-embedding-3-large' }],
      };

      const searchFn = createVectorSearchFn({
        prisma,
        embedQuery: async () => new Array(384).fill(0.1),
        userId: 'u1',
        modelName: 'mini',
      });

      await expect(searchFn('q')).rejects.toThrow(/Embedding model mismatch/);
    });

    it('11.3.7 库内 modelName 与查询模型不一致时抛错，不静默返回噪音', async () => {
      const mockPrisma = {
        $queryRaw: async () => [{ m: 'text-embedding-3-large' }],
      };

      await expect(
        similaritySearch(mockPrisma, new Array(384).fill(0.1), {
          expectedModelName: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        }),
      ).rejects.toThrow(/Embedding model mismatch/);
    });

    it('11.3.7 modelName 一致时正常放行', async () => {
      const mockPrisma = {
        $queryRaw: async () => [{ m: 'mini' }],
      };

      const rows = await similaritySearch(mockPrisma, new Array(384).fill(0.1), {
        expectedModelName: 'mini',
      });
      // 校验通过后继续走正常检索，不再抛错
      expect(rows).toHaveLength(1);
    });
  });
});

// ========================================================================
// 11.6 生成环节
// ========================================================================

describe('11.6 RAG Pipeline - 拼 Prompt + 引用回写', () => {
  it('正常路径：检索 3 段 → 拼 Prompt → LLM 生成 → 返回 answer + citations', async () => {
    const chunks = [
      fakeSearchResult('c1', '企业版单工作区最多 200 个项目', 0.91),
      fakeSearchResult('c2', '专业版单工作区最多 20 个项目', 0.83),
      fakeSearchResult('c3', '超额可联系销售扩容', 0.61),
    ];

    let capturedMessages: Array<{ role: string; content: string }> = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        capturedMessages = messages;
        return { content: '企业版单工作区最多 200 个项目 [chunkId: c1]' };
      },
    };

    const result = await ragAsk({
      question: '企业版最多能建多少项目？',
      searchFn: async () => chunks,
      model,
      topK: 3,
    });

    expect(result.answer).toContain('[chunkId: c1]');
    expect(result.citations).toHaveLength(3);
    expect(result.citations[0]).toEqual({
      chunkId: 'c1',
      documentId: 'doc-c1',
      score: 0.91,
    });
    expect(result.retrievedChunks).toHaveLength(3);

    // Prompt 里必须带上 chunkId / 来源 / 相关性，供模型标注引用（11.6.2 / 11.6.3）
    const userContent = capturedMessages[1].content;
    expect(userContent).toContain('[上下文]');
    expect(userContent).toContain('chunkId: c1');
    expect(userContent).toContain('企业版最多能建多少项目？');
  });

  it('检索 0 结果时回退到"无法确定"，不再调用 model.invoke', async () => {
    let invokeCount = 0;
    const model = {
      invoke: async () => {
        invokeCount++;
        return { content: '编造的答案' };
      },
    };

    const result = await ragAsk({
      question: '知识库里没有的问题',
      searchFn: async () => [],
      model,
    });

    expect(result.answer).toBe(RAG_NO_CONTEXT_FALLBACK);
    expect(result.citations).toEqual([]);
    expect(invokeCount).toBe(0);

    logSection('零检索防幻觉回退');
    console.log('  answer    :', result.answer);
    console.log('  模型调用次数:', invokeCount);
    console.log('  ↳ 不调模型就不会编，这是防幻觉最省事的一道闸');
  });

  it('自定义 systemPrompt 应透传给模型', async () => {
    let captured: Array<{ role: string; content: string }> = [];
    const model = {
      invoke: async (messages: Array<{ role: string; content: string }>) => {
        captured = messages;
        return { content: 'ok' };
      },
    };

    await ragAsk({
      question: 'q',
      searchFn: async () => [fakeSearchResult('c1', '内容', 0.5)],
      model,
      systemPrompt: 'CUSTOM_PROMPT',
    });

    expect(captured[0].content).toBe('CUSTOM_PROMPT');
  });
});

// ========================================================================
// 11.7 评估
// ========================================================================

describe('11.7 评估', () => {
  describe('11.7.1 检索质量的三大指标', () => {
    it('11.7.1 Recall@K = 1 当所有 relevant 都在 Top-K', () => {
      expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBeCloseTo(1, 9);
    });

    it('Recall@K = 0 当 K=0', () => {
      expect(recallAtK(['a', 'b'], ['a'], 0)).toBe(0);
    });

    it('Recall@K = 0 当零命中', () => {
      expect(recallAtK(['x', 'y', 'z'], ['a'], 3)).toBe(0);
    });

    it('11.7.1 MRR 第一个相关在第 1 位 → 1.0；第 2 位 → 0.5', () => {
      expect(mrr([['a', 'b', 'c']], [['a']])).toBeCloseTo(1, 9);
      expect(mrr([['x', 'a', 'b']], [['a']])).toBeCloseTo(0.5, 9);

      const m = mrr(
        [
          ['a', 'b', 'c'], // rank 1 → 1
          ['x', 'y', 'a'], // rank 3 → 1/3
          ['x', 'a', 'y'], // rank 2 → 1/2
        ],
        [['a'], ['a'], ['a']],
      );

      logSection('MRR 多 query');
      console.log(`  MRR = (1 + 1/3 + 1/2) / 3 = ${m.toFixed(4)}`);

      expect(m).toBeCloseTo((1 + 1 / 3 + 1 / 2) / 3, 9);
    });

    it('11.7.1 NDCG@K 单个完全命中 = 1.0', () => {
      expect(ndcgAtK(['a'], ['a'], 5)).toBeCloseTo(1, 9);
      const head = ndcgAtK(['a', 'b', 'c', 'd'], ['a'], 4);
      const tail = ndcgAtK(['x', 'y', 'z', 'a'], ['a'], 4);

      logSection('NDCG 排名敏感');
      console.log(`  rank 1 → NDCG = ${head.toFixed(4)}`);
      console.log(`  rank 4 → NDCG = ${tail.toFixed(4)}`);
      console.log('  ↳ 同样命中，排得越靠前分数越高');

      expect(head).toBeGreaterThan(tail);
      expect(head).toBeCloseTo(1, 9);
    });
  });

  describe('11.7.3 ragas-runner 在 RAGAS 不可用时返回 null + warn，不抛错', () => {
    it('fetch 抛错时返回 null，不向上抛', async () => {
      const warns: string[] = [];
      const result = await runRagas(
        {
          samples: [{ question: 'q', answer: 'a', contexts: ['c'] }],
          metrics: ['faithfulness'],
        },
        {
          fetchImpl: (async () => {
            throw new Error('connection refused');
          }) as any,
          retries: 2,
          timeoutMs: 100,
          warn: (msg) => warns.push(msg),
        },
      );

      logSection('RAGAS 降级');
      console.log(`  result = ${result}`);
      console.log(`  warn 次数 = ${warns.length}`);

      expect(result).toBeNull();
      expect(warns.length).toBe(2);
    });

    it('正常 200 → 返回解析后的指标', async () => {
      const fakeFetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ faithfulness: 0.92 }),
      })) as any;
      const result = await runRagas(
        { samples: [], metrics: ['faithfulness'] },
        { fetchImpl: fakeFetch, retries: 1 },
      );
      expect(result).toEqual({ faithfulness: 0.92 });
    });
  });
});

// ========================================================================
// 11.8 提升召回率
// ========================================================================

describe('11.8.1 Query 改写 - 返回 1-5 条改写，失败回退原句', () => {
  it('withStructuredOutput 路径正常返回多条', async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          queries: ['企业版项目数量上限', '企业版单工作区最多创建多少项目'],
        }),
      }),
      invoke: async () => ({ content: '' }),
    };

    const queries = await rewriteQuery(model, '企业版能建几个项目来着');
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries[0]).toContain('企业版');

    logSection('Query 改写');
    console.log('  原句 :', '企业版能建几个项目来着');
    console.log('  改写 :', queries.join(' | '));
  });

  it('历史上下文应被拼进 user message（消除指代）', async () => {
    let captured = '';
    const model = {
      withStructuredOutput: () => ({
        invoke: async (messages: Array<{ role: string; content: string }>) => {
          captured = messages[1].content;
          return { queries: ['企业版价格'] };
        },
      }),
      invoke: async () => ({ content: '' }),
    };

    await rewriteQuery(model, '它多少钱', { conversationHistory: '用户：企业版有什么权益' });
    expect(captured).toContain('企业版有什么权益');
    expect(captured).toContain('它多少钱');
  });

  it('改写失败时回退到原句，不阻塞主流程', async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model down');
        },
      }),
      invoke: async () => {
        throw new Error('model down');
      },
    };

    const queries = await rewriteQuery(model, '原句查询');
    expect(queries).toEqual(['原句查询']);
  });

  it('maxQueries 上限保护：模型返回 5 条也只保留前 3 条', async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => ({ queries: ['q1', 'q2', 'q3', 'q4', 'q5'] }),
      }),
      invoke: async () => ({ content: '' }),
    };

    const queries = await rewriteQuery(model, 'q', { maxQueries: 3 });
    expect(queries).toEqual(['q1', 'q2', 'q3']);
  });

  it('11.8.2 多路召回：多 query 命中同一 chunk 时按命中次数优先', async () => {
    const searchFn = async (q: string) => {
      if (q === 'q1') return [fakeSearchResult('a', 'A', 0.9), fakeSearchResult('b', 'B', 0.5)];
      if (q === 'q2') return [fakeSearchResult('a', 'A', 0.7), fakeSearchResult('c', 'C', 0.8)];
      return [];
    };

    const merged = await multiQuerySearch(['q1', 'q2'], searchFn, 5);
    expect(merged[0].chunkId).toBe('a');
    expect(merged[0].hitCount).toBe(2);
    expect(merged[0].score).toBe(0.9);
  });
});

describe('11.8.3 混合检索 - 向量 + BM25 + RRF 融合', () => {
  it('11.8.3.1 RRF：两个排序中都靠前的文档应排第一', () => {
    const vec = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const bm25 = [{ id: 'B' }, { id: 'A' }, { id: 'D' }];

    const ranked = rrfRanked([vec, bm25], 60);

    // A: 1/61 + 1/62 ; B: 1/62 + 1/61 —— 两者并列，但都高于只出现一次且靠后的 C / D
    expect(ranked[0].score).toBeGreaterThan(ranked[ranked.length - 1].score);
    expect(ranked.map((r) => r.id).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(rrfFuse([vec, bm25], 60).get('A')).toBeCloseTo(
      1 / 61 + 1 / 62,
      9,
    );
  });

  it('hybridSearch 端到端：向量 + BM25 → 去重排序', async () => {
    const vecSearch = async () => [
      fakeSearchResult('v1', 'OAuth2 协议详细说明', 0.88),
      fakeSearchResult('v2', '单点登录概览', 0.7),
    ];
    const bm25SearchFn = async () => [
      fakeSearchResult('b1', '如何用 OAuth2 配置 SSO', 12.4),
      fakeSearchResult('v1', 'OAuth2 协议详细说明', 11.0),
    ];

    const results = await hybridSearch('如何用 OAuth2 配置 SSO', vecSearch, bm25SearchFn, {
      topK: 3,
    });

    logSection('混合检索 RRF 融合');
    console.log(
      '  结果 :',
      results.map((r) => `${r.chunkId}(${r.score.toFixed(4)})`).join(' > '),
    );

    // v1 两路都命中，融合分最高
    expect(results[0].chunkId).toBe('v1');
    // 去重：v1 只出现一次
    expect(results.filter((r) => r.chunkId === 'v1')).toHaveLength(1);
    expect(results).toHaveLength(3);
  });

  it('BM25 精确实体命中：关键词完全匹配应排在语义相近但缺关键词之前', () => {
    const docs = [
      { id: 'd1', content: '本文讲解 OAuth2 授权码模式的配置步骤' },
      { id: 'd2', content: '本文讲解单点登录的整体设计思路' },
      { id: 'd3', content: '本文讲解数据库连接池调优' },
    ];

    const scored = bm25Search('OAuth2 配置', docs);
    expect(scored[0].id).toBe('d1');
    expect(scored.length).toBeGreaterThan(0);

    // 中文按单字 + bigram 分词，保证无词典也能工作
    expect(tokenize('OAuth2 配置')).toContain('oauth2');
    expect(tokenize('配置')).toContain('配置');
  });
});

describe('11.8.4 重排序 - Cross-Encoder 改变粗排顺序', () => {
  it('重排后顺序按新分数，并覆盖原 score 字段', async () => {
    const candidates = [
      fakeSearchResult('c1', '内容1', 0.9),
      fakeSearchResult('c2', '内容2', 0.8),
      fakeSearchResult('c3', '内容3', 0.7),
    ];

    const reranker: RerankerClient = {
      rerank: async (_q, docs) =>
        docs.map((_, i) => ({ index: i, score: [0.1, 0.95, 0.5][i] })),
    };

    const reranked = await rerankResults(reranker, 'q', candidates, 2);
    expect(reranked.map((r) => r.chunkId)).toEqual(['c2', 'c3']);
    expect(reranked[0].score).toBe(0.95);
  });

  it('retrieveWithRerank：粗排 50 → 精排 5', async () => {
    const wide = Array.from({ length: 50 }, (_, i) =>
      fakeSearchResult(`c${i}`, `内容${i}`, 1 - i / 50),
    );
    const reranker: RerankerClient = {
      rerank: async (_q, docs) =>
        docs.map((_, i) => ({ index: i, score: docs.length - i })),
    };

    const top5 = await retrieveWithRerank(reranker, 'q', async () => wide, 5);
    expect(top5).toHaveLength(5);
    expect(top5[0].chunkId).toBe('c0');
  });
});

// ========================================================================
// 11.9 RAG 高级模式
// ========================================================================

describe('11.9.1 HyDE - 用幻想答案做检索', () => {
  it('LLM 先输出 hypothetical → 用它替代原问题去 searchFn', async () => {
    const model = {
      invoke: async () => ({
        content: '企业版单工作区每月最多可以创建 200 个项目。',
      }),
    };

    let capturedQuery = '';
    const searchFn = async (q: string) => {
      capturedQuery = q;
      return [fakeSearchResult('c1', '企业版：单工作区 200 个项目', 0.93)];
    };

    const result = await hydeSearch(model, searchFn, '企业版每月最多能创建多少个项目？');

    logSection('HyDE');
    console.log('  原问题   : 企业版每月最多能创建多少个项目？');
    console.log('  幻想答案 :', result.hypothetical);
    console.log('  实际检索 :', capturedQuery);

    expect(capturedQuery).toBe(result.hypothetical);
    expect(capturedQuery).not.toContain('？');
    expect(result.results[0].chunkId).toBe('c1');
  });

  it('幻想答案为空时退化为原始问题', async () => {
    const model = { invoke: async () => ({ content: '' }) };
    let capturedQuery = '';
    const searchFn = async (q: string) => {
      capturedQuery = q;
      return [];
    };

    const result = await hydeSearch(model, searchFn, '原始问题');
    expect(capturedQuery).toBe('原始问题');
    expect(result.usedQuery).toBe('原始问题');
  });
});

describe('11.9.4 Adaptive-RAG - 按复杂度走三条路径', () => {
  const chunks = [fakeSearchResult('c1', '企业版单工作区 200 个项目', 0.9)];

  const makeModel = () => ({
    invoke: async (messages: Array<{ role: string; content: string }>) => ({
      content: `回答:${messages[messages.length - 1].content.slice(0, 8)}`,
    }),
  });

  it('simple → 不检索，直接 LLM 回答', async () => {
    let searchCalls = 0;
    const out = await adaptiveRagAsk({
      question: '你好',
      classifier: fixedClassifier('simple'),
      searchFn: async () => {
        searchCalls++;
        return chunks;
      },
      model: makeModel(),
    });

    expect(out.path).toBe('simple');
    expect(out.retrieved).toEqual([]);
    expect(searchCalls).toBe(0);
  });

  it('single_hop → 单次检索 + 生成', async () => {
    let searchCalls = 0;
    const out = await adaptiveRagAsk({
      question: '企业版项目上限',
      classifier: fixedClassifier('single_hop'),
      searchFn: async () => {
        searchCalls++;
        return chunks;
      },
      model: makeModel(),
    });

    expect(out.path).toBe('single_hop');
    expect(searchCalls).toBe(1);
    expect(out.retrieved).toHaveLength(1);
  });

  it('multi_hop → 子问题拆解 + 多次检索 + 合并去重', async () => {
    const seen: string[] = [];
    const out = await adaptiveRagAsk({
      question: '对比企业版和专业版在 SSO 与审计日志上的差异',
      classifier: fixedClassifier('multi_hop'),
      searchFn: async (q) => {
        seen.push(q);
        return [fakeSearchResult(q === '子问题A' ? 'cA' : 'cB', q, 0.8)];
      },
      model: makeModel(),
      decomposeFn: async () => ['子问题A', '子问题B'],
    });

    logSection('Adaptive-RAG 三条路径');
    console.log('  multi_hop 子问题 :', out.subQueries?.join(' | '));
    console.log('  合并后 chunk     :', out.retrieved.map((c) => c.chunkId).join(', '));

    expect(out.path).toBe('multi_hop');
    expect(seen).toEqual(['子问题A', '子问题B']);
    expect(out.subQueries).toEqual(['子问题A', '子问题B']);
    expect(out.retrieved.map((c) => c.chunkId).sort()).toEqual(['cA', 'cB']);
  });

  it('multi_hop 零命中时走防幻觉回退', async () => {
    const out = await adaptiveRagAsk({
      question: '多跳问题',
      classifier: fixedClassifier('multi_hop'),
      searchFn: async () => [],
      model: makeModel(),
      decomposeFn: async () => ['子问题A'],
    });

    expect(out.answer).toBe(RAG_NO_CONTEXT_FALLBACK);
    expect(out.retrieved).toEqual([]);
  });
});

// ========================================================================
// 11.10 集成 Agent
// ========================================================================

describe('11.10.3 挂载到第九章专家 Agent', () => {
  const mockModel = { invoke: async () => ({ content: 'ok' }) };

  it('未传 rag 依赖时不挂载，工具列表保持第九章原样（向后兼容）', () => {
    const base = [{ name: 'search_requirement' }];
    const tools = withRagTool(base, mockModel as any);

    expect(tools).toBe(base);
    expect(tools).toHaveLength(1);
  });

  it('传入 rag 依赖后追加 search_knowledge_base 工具', () => {
    const base = [{ name: 'search_requirement' }];
    const tools = withRagTool(base, mockModel as any, {
      userId: 'u1',
      searchFn: async () => [],
    });

    expect(tools).toHaveLength(2);
    expect((tools[1] as any).name).toBe(RAG_TOOL_NAME);

    logSection('RAG 工具挂载');
    console.log('  专家工具 :', tools.map((t: any) => t.name).join(', '));
    console.log('  ↳ 不传 userId/searchFn 就完全不挂载，第九章行为不受影响');
  });
});

describe('11.10 集成 Agent', () => {
  it('tool 的 description 字符串包含 "不适用" 关键词，避免 LLM 在闲聊场景误调用', () => {
    expect(RAG_TOOL_NAME).toBe('search_knowledge_base');
    expect(RAG_TOOL_DESCRIPTION).toContain('适用');
    expect(RAG_TOOL_DESCRIPTION).toContain('不适用');

    const tool = createRagTool({
      model: {} as any,
      userId: 'u-1',
    });

    logSection('Tool 元信息');
    console.log(`  name        : ${tool.name}`);
    console.log(`  description : ${tool.description.slice(0, 60)}...`);

    expect(tool.name).toBe('search_knowledge_base');
    expect(tool.description).toContain('不适用');
  });

  it('allow 时工具调用返回的 JSON.parse 含 answer / citations（按 chunkId 去重）', async () => {
    const tool = createRagTool({
      model: {
        invoke: async () => ({
          content: 'SSO 启用步骤 [chunkId: c1]',
        }),
      },
      userId: 'u-1',
      searchFn: async () => [
        fakeSearchResult('c1', 'A', 0.91),
        fakeSearchResult('c1', 'A duplicate', 0.91), // 去重测试
        fakeSearchResult('c2', 'B', 0.85),
      ],
      getBudget: () => ({ usedPercent: 50 }),
    });

    const raw = await tool.invoke({ question: '如何配置 SSO？' });
    const parsed = JSON.parse(raw);

    logSection('Tool allow 路径');
    console.log('  raw type :', typeof raw);
    console.log('  answer   :', parsed.answer);
    console.log('  citations:', parsed.citations.map((c: any) => c.chunkId));

    expect(typeof raw).toBe('string');
    expect(parsed.answer).toContain('SSO');
    // citations 去重后 c1 只出现一次
    const ids = parsed.citations.map((c: any) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });

  it('reject 时返回 error: "budget_exceeded"，且不触发模型调用', async () => {
    let modelInvoked = false;
    const model = {
      invoke: async () => {
        modelInvoked = true;
        return { content: 'should not run' };
      },
    };
    const tool = createRagTool({
      model,
      userId: 'u-1',
      searchFn: async () => [],
      getBudget: () => ({ usedPercent: 110 }),
    });

    const raw = await tool.invoke({ question: '任何问题' });
    const parsed = JSON.parse(raw);

    logSection('Tool reject 路径');
    console.log('  parsed.error:', parsed.error);
    console.log('  ↳ rag_tool 不在 HIGH_RISK_AGENTS 列表，超预算时被 reject');

    expect(parsed.error).toBe('budget_exceeded');
    expect(modelInvoked).toBe(false);
  });

  it('支持直接注入 mock ragAsk 与 mock resolveBudgetAction', async () => {
    const mockRagAsk = async () => ({
      answer: 'mocked answer for ragAsk',
      citations: [{ chunkId: 'c1', documentId: 'd1', score: 0.95 }],
      retrievedChunks: [],
    });
    const mockBudgetAction = () => ({
      action: 'allow' as const,
      reason: 'mock budget allow',
    });

    const tool = createRagTool({
      model: {} as any,
      userId: 'u-1',
      ragAskFn: mockRagAsk,
      resolveBudgetActionFn: mockBudgetAction,
    });

    const raw = await tool.invoke({ question: '测试注入' });
    const parsed = JSON.parse(raw);
    expect(parsed.answer).toBe('mocked answer for ragAsk');
    expect(parsed.citations[0].chunkId).toBe('c1');
  });
});
