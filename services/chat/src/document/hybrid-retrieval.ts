/**
 * hybrid-retrieval.ts —— 第二十章 20.2：主链路检索升级的生产版实现。
 *
 * 三段式：BM25 关键词路 → RRF 融合多召回 → embedding 余弦重排精排。
 *   1. 向量 + BM25 两路各召回 topK*3（先保 Recall，少漏）
 *   2. RRF（Reciprocal Rank Fusion）按名次累加 1/(K+rank) 融合去重（不看原始分数量纲）
 *   3. embedding 余弦对候选精排到 topK（再保 Precision，去噪）
 *
 * 为什么是「轻量真实」而不是工业满血：真正的工业方案会用 Postgres tsvector + GIN 索引、
 * cross-encoder 重排模型。这里在内存里对候选集算 BM25，好处是**零数据模型变更、零外部依赖**，
 * 且效果可以被第十七章的 Recall/Precision 指标量化。代价是候选集有上限（见 BM25 语料 cap）。
 *
 * BM25 说明：基于词频(TF)与逆文档频率(IDF)的字面匹配算法，擅长命中专有名词、编号、配置项，
 * 正好补向量检索「语义相似但字面不同」的盲区。K1 控制词频饱和，B 控制文档长度归一强度。
 */
export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export type RetrieveFn = (query: string) => Promise<RetrievalResult[]>;

/** BM25 参数：K1 词频饱和系数，B 文档长度归一强度。 */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/** RRF 融合的平滑常数，降低极靠前名次的分数差异。 */
const RRF_K = 60;

// ── 余弦相似度（内联以保持本模块自包含，避免依赖 rag 教学实现）──────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 中英混合分词：latin 按词（转小写），CJK 按单字。
 * 中文按单字切是因为没有接入分词器（jieba/nodejieba）；单字切对 BM25 仍有效，
 * 但会略微放大常见字的权重，靠 IDF 压制。
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const latin = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  return [...latin, ...cjk];
}

/**
 * 在候选语料上算 BM25，返回按分数降序的 topK。
 * IDF 用语料内文档频次现算，因此**必须传完整候选集**，不能只传已截断的结果。
 */
export function bm25Search(
  query: string,
  corpus: RetrievalResult[],
  topK = 5,
): RetrievalResult[] {
  if (corpus.length === 0) return [];
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const docTokens = corpus.map((d) => tokenize(d.content));
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLength =
    docLengths.reduce((a, b) => a + b, 0) / corpus.length || 1;

  // 文档频次 df(term)
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const toks of docTokens) if (toks.includes(term)) count++;
    df.set(term, count);
  }

  const N = corpus.length;
  return corpus
    .map((doc, i) => {
      const tf = new Map<string, number>();
      for (const t of docTokens[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of queryTerms) {
        const f = tf.get(term) ?? 0;
        if (f === 0) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const denom =
          f + BM25_K1 * (1 - BM25_B + (BM25_B * docLengths[i]) / avgDocLength);
        score += idf * ((f * (BM25_K1 + 1)) / denom);
      }
      return { ...doc, score };
    })
    .filter((d) => d.score > 0) // 零命中过滤：一个查询词都没命中的文档不该进候选
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** RRF 融合多路的排名（不归一化原始分数，避免不同算法量纲打架）。 */
function rrfFuse(
  rankedLists: Array<Array<{ id: string }>>,
  rrfK = RRF_K,
): Map<string, number> {
  const scoreMap = new Map<string, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (rrfK + i + 1));
    }
  }
  return scoreMap;
}

/**
 * 向量 + BM25 两路多召回 → RRF 融合去重 → 按融合分截到 topK。
 * 两路并行执行（Promise.all），所以总耗时≈较慢的那一路的耗时。
 */
export async function hybridSearch(
  query: string,
  vectorSearch: RetrieveFn,
  bm25Search: RetrieveFn,
  topK = 5,
): Promise<RetrievalResult[]> {
  const [vec, bm25] = await Promise.all([
    vectorSearch(query),
    bm25Search(query),
  ]);
  const scoreMap = rrfFuse([
    vec.map((r) => ({ id: r.chunkId })),
    bm25.map((r) => ({ id: r.chunkId })),
  ]);
  const merged = new Map<string, RetrievalResult>();
  for (const r of [...vec, ...bm25]) {
    if (!merged.has(r.chunkId)) merged.set(r.chunkId, r);
  }
  return [...merged.values()]
    .map((r) => ({ ...r, score: scoreMap.get(r.chunkId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * embedding 余弦重排：把 query 和所有候选一次性算 embedding，按余弦相似度精排到 topK。
 * vectors[0] 是 query 向量，其余依次对应 candidates。
 */
export async function embeddingRerank(
  query: string,
  candidates: RetrievalResult[],
  embed: (texts: string[]) => Promise<number[][]>,
  topK = 5,
): Promise<RetrievalResult[]> {
  if (candidates.length === 0) return [];
  const vectors = await embed([query, ...candidates.map((c) => c.content)]);
  const queryVec = vectors[0];
  if (!queryVec || queryVec.length === 0) return candidates.slice(0, topK);
  return candidates
    .map((c, i) => ({ ...c, score: cosineSimilarity(queryVec, vectors[i + 1]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
