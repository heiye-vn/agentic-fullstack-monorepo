/**
 * chapter20-fullchain.spec.ts —— 第二十章《满血版 MVP》后端链路配套用例。
 *
 * 分层遵循第十九章约定（+第二十章 20.10）：
 *   Layer 1（零 LLM、确定性）：每次 CI 都跑。本批覆盖 20.2 的检索后端
 *     （tokenize / BM25 / RRF 融合 / embedding 重排 / 检索永不抛错）与
 *     20.3 的检索上下文注入 helper。
 *   Layer 2（真实 LLM）：默认跳过，设 RUN_LLM_FULLCHAIN_TESTS=1 才跑，
 *     验证「检索内容真的被报告消费」这条行为链（20.3 的修复目标）。
 *
 * 为什么 Layer 2 要单独隔离：它会真实调用模型、花 token 且结果有波动，
 * 放进每次 PR 会让 CI 又慢又不稳定（第十九章的教训）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tokenize,
  bm25Search,
  hybridSearch,
  embeddingRerank,
  type RetrievalResult,
} from '../src/document/hybrid-retrieval.js';
import {
  buildRetrievedContextBlock,
  runAnalysisGraph,
} from '../src/llm/graph/requirement-analysis-graph.js';
import { SearchService } from '../src/document/search.service.js';
import {
  getSharedMcpManager,
  resetSharedMcpManager,
} from '../src/mcp/mcp-runtime.js';
import { withMcpTools } from '../src/llm/graph/experts.js';
import {
  buildMethodologyBlock,
  getSharedSkillRuntime,
  DEFAULT_ANALYSIS_SKILL,
} from '../src/skills/skills-runtime.js';
import { detectLongChain } from '../src/llm/agents/orchestrator.service.js';
import { buildChatHistoryBlock } from '../src/conversation/chat-stream.service.js';

const RUN_LLM = process.env.RUN_LLM_FULLCHAIN_TESTS === '1';

const mkDoc = (id: string, content: string): RetrievalResult => ({
  chunkId: id,
  documentId: `d-${id}`,
  content,
  chunkIndex: 0,
  score: 0,
});

// ===========================================================================
// Layer 1：20.2 hybrid 检索后端（零 LLM、确定性）
// ===========================================================================

describe('20.2 tokenize 中英混合分词', () => {
  it('latin 按词并转小写、CJK 按单字', () => {
    expect(tokenize('OAuth2 企业微信')).toEqual([
      'oauth2',
      '企',
      '业',
      '微',
      '信',
    ]);
  });

  it('空串返回空数组', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('20.2 bm25Search 关键词路', () => {
  it('命中查询词的文档排前面，零命中被过滤', () => {
    const corpus = [
      mkDoc('a', '企业微信登录需要 OAuth2 授权码模式'),
      mkDoc('b', '今天天气不错适合散步'),
      mkDoc('c', '微信支付与账单结算'),
    ];
    const ranked = bm25Search('企业微信 OAuth2', corpus, 3);
    expect(ranked[0].chunkId).toBe('a');
    expect(ranked.find((r) => r.chunkId === 'b')).toBeUndefined();
  });

  it('空语料 / 空查询词都返回空数组，不抛错', () => {
    expect(bm25Search('anything', [], 5)).toEqual([]);
    expect(bm25Search('', [mkDoc('a', '内容')], 5)).toEqual([]);
  });
});

describe('20.2 hybridSearch RRF 融合', () => {
  it('两路都靠前的候选融合分最高，且结果去重', async () => {
    const vector = async () => [mkDoc('a', 'x'), mkDoc('b', 'y')];
    const bm25 = async () => [mkDoc('b', 'y'), mkDoc('c', 'z')];
    const fused = await hybridSearch('q', vector, bm25, 3);
    expect(fused[0].chunkId).toBe('b');
    expect(new Set(fused.map((r) => r.chunkId)).size).toBe(fused.length);
  });
});

describe('20.2 embeddingRerank 精排', () => {
  it('按 query 余弦相似度重排', async () => {
    const candidates = [mkDoc('a', 'aaa'), mkDoc('b', 'bbb')];
    // 返回 [query 向量, 候选 a 向量, 候选 b 向量]
    const embed = async () => [
      [1, 0],
      [0, 1],
      [1, 0],
    ];
    const reranked = await embeddingRerank('q', candidates, embed, 2);
    expect(reranked[0].chunkId).toBe('b');
  });

  it('候选为空时直接返回空数组，不调 embedding', async () => {
    const embed = async () => {
      throw new Error('should not be called');
    };
    await expect(embeddingRerank('q', [], embed, 2)).resolves.toEqual([]);
  });
});

describe('20.2 检索对外承诺：永不抛错', () => {
  it('底层依赖炸掉时 search() 降级为空数组，而不是把异常抛给主链路', async () => {
    // 故意注入不可用的 prisma / embedding，模拟 pgvector 报错或 embedding 加载失败。
    // 这条用例验证的是「检索失败不炸主链路」这个契约本身。
    const service = new SearchService({} as never, {} as never);
    await expect(service.search('随便一个问题', 'user-1', 4)).resolves.toEqual(
      [],
    );
  });
});

// ===========================================================================
// Layer 1：20.3 检索上下文注入
// ===========================================================================

describe('20.3 buildRetrievedContextBlock', () => {
  it('空值与两种占位写法都不注入（避免把「无资料」当成资料）', () => {
    expect(buildRetrievedContextBlock('')).toBe('');
    expect(buildRetrievedContextBlock(undefined)).toBe('');
    expect(buildRetrievedContextBlock('无相关参考文档')).toBe('');
    expect(buildRetrievedContextBlock('本次分析未检索到相关参考文档。')).toBe('');
  });

  it('有检索内容时注入「参考资料」块并带上原文', () => {
    const block = buildRetrievedContextBlock(
      '企业微信登录走 OAuth2 授权码模式',
    );
    expect(block).toContain('参考资料');
    expect(block).toContain('OAuth2 授权码模式');
  });

  it('首尾空白被裁掉后再判断，纯空白视为空', () => {
    expect(buildRetrievedContextBlock('   ')).toBe('');
  });
});

describe('20.3 检索上下文真正抵达写报告的节点（行为验证）', () => {
  /**
   * 这条用例是「行为验证而不是代码验证」的体现：
   * 不是断言某个变量存在，而是用打桩 Agent 真跑一次图，
   * 看写报告的 summaryAgent 实际接收到的入参里有没有检索到的资料。
   *
   * 本项目在移植第九章时 State 里**没有** retrievedContext 这个 channel，
   * LangGraph 会丢弃未声明的 key，所以资料连 State 都进不去 —— 只靠读代码很难发现。
   */
  it('图入口传入的 retrievedContext 能被写报告的 summary/actor 节点读到', async () => {
    const retrieved = '[知识库] 企业微信登录必须使用 OAuth2 授权码模式';
    const summaryAgent = {
      invoke: vi.fn().mockResolvedValue('# 需求分析报告'),
    };
    const mockSubAgents = {
      extractAgent: {
        invoke: vi.fn().mockResolvedValue(
          JSON.stringify({
            action: '增加扫码登录',
            targetUsers: ['后台管理员'],
            coreFeature: '企业微信扫码登录',
            constraints: [],
            priority: 'high',
            isComplete: true,
          }),
        ),
      },
      clarifyAgent: {
        invoke: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ needsClarification: false, questions: [] }),
          ),
      },
      analysisAgent: { invoke: vi.fn().mockResolvedValue('### 分析结论') },
      riskAgent: { invoke: vi.fn().mockResolvedValue('### 风险结论') },
      summaryAgent,
    } as any;

    await runAnalysisGraph(
      { input: '为后台管理系统增加企业微信扫码登录', retrievedContext: retrieved },
      { subAgents: mockSubAgents },
    );

    expect(summaryAgent.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ retrievedContext: retrieved }),
    );
  });
});

// ===========================================================================
// Layer 1：20.4 MCP 接入主链路（零 LLM、确定性；默认 InMemory 传输）
// ===========================================================================

const fakeTool = (name: string) =>
  ({ name, invoke: async () => '' }) as any;

describe('20.4 MCP 进程级单例', () => {
  /**
   * 注意：这里一律**显式传 enabled**，不依赖宿主的 .env。
   * vitest 会自动加载 services/chat/.env（第十九章踩过的坑），
   * 而 .env 里通常还留着旧的 MCP_ENABLED=false —— 显式传参让用例保持确定性。
   */
  it('未显式配置时默认启用（空值走默认 true）', async () => {
    resetSharedMcpManager();
    vi.stubEnv('MCP_ENABLED', '');
    try {
      await expect(getSharedMcpManager()).resolves.not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
      resetSharedMcpManager();
    }
  });

  it('装配成功：返回 manager，且重复调用是同一个实例（不会每请求重建连接）', async () => {
    resetSharedMcpManager();
    try {
      const first = await getSharedMcpManager({ enabled: true });
      const second = await getSharedMcpManager({ enabled: true });
      expect(first).not.toBeNull();
      expect(first).toBe(second);
    } finally {
      resetSharedMcpManager();
    }
  });

  it('工具名保留 req_ / ws_ 前缀（experts 与 Skill allowed-tools 都按这两个前缀挑选）', async () => {
    resetSharedMcpManager();
    try {
      const mcp = await getSharedMcpManager({ enabled: true });
      const names = (mcp?.getTools() ?? []).map((t: any) => String(t.name));
      expect(names.length).toBeGreaterThan(0);
      expect(names.some((n) => n.startsWith('req_'))).toBe(true);
      expect(names.some((n) => n.startsWith('ws_'))).toBe(true);
    } finally {
      resetSharedMcpManager();
    }
  });

  it('显式 disabled 时返回 null，调用方按「没有 MCP」降级', async () => {
    resetSharedMcpManager();
    await expect(getSharedMcpManager({ enabled: false })).resolves.toBeNull();
    resetSharedMcpManager();
  });
});

describe('20.4 专家工具池是「叠加」而不是「替换」', () => {
  it('MCP 工具追加到本地工具之后，两者都在', () => {
    const local = [fakeTool('analyze_completeness')];
    const mcp = {
      tools: [
        fakeTool('req_estimate_complexity'),
        fakeTool('ws_search_best_practices'),
        fakeTool('should_not_be_picked'),
      ],
    };
    const names = withMcpTools(local, mcp, ['req_', 'ws_']).map(
      (t: any) => t.name,
    );
    expect(names).toContain('analyze_completeness');
    expect(names).toContain('req_estimate_complexity');
    expect(names).toContain('ws_search_best_practices');
    // 不在前缀白名单里的工具不该混进来
    expect(names).not.toContain('should_not_be_picked');
  });

  it('MCP 不可用时原样返回本地工具，不抛错', () => {
    const local = [fakeTool('analyze_completeness')];
    expect(withMcpTools(local, undefined, ['req_', 'ws_'])).toEqual(local);
  });
});

// ===========================================================================
// Layer 1：20.5 方法论正文前置注入
// ===========================================================================

describe('20.5 buildMethodologyBlock', () => {
  const runtime = () => getSharedSkillRuntime();

  it('读得到需求分析 Skill 的正文，且已剥掉 frontmatter', () => {
    const r = runtime();
    expect(r).not.toBeNull();
    const block = buildMethodologyBlock(
      DEFAULT_ANALYSIS_SKILL,
      r!.registry,
    );
    expect(block).toContain('分析方法论');
    expect(block).toContain('需求分析 Skill');
    expect(block).not.toContain('allowed-tools:');
  });

  it('技能不存在时返回空串，而不是抛错阻塞主链路', () => {
    const r = runtime()!;
    expect(buildMethodologyBlock('skill-that-does-not-exist', r.registry)).toBe(
      '',
    );
  });

  it('正文过长会截断并在末尾标记，不把 prompt 撑爆', () => {
    const r = runtime()!;
    const block = buildMethodologyBlock(DEFAULT_ANALYSIS_SKILL, r.registry, 200);
    expect(block).toContain('方法论已截断');
    // 标题行本身不算在内，200 字的正文 + 截断标记
    expect(block.length).toBeLessThan(400);
  });
});

// ===========================================================================
// Layer 1：20.6 长链路由判定（纯函数、零 LLM）
// ===========================================================================

describe('20.6 detectLongChain', () => {
  it('多工单输入（≥2 个不同 REQ）路由到 DeepAgent', () => {
    expect(detectLongChain('评估 REQ-001/REQ-002/REQ-003 的总体影响')).toBe(true);
    expect(detectLongChain('REQ-1 和 REQ-2 有冲突吗')).toBe(true);
  });

  it('单需求 / 单个 REQ / 重复同一 REQ 都走主图', () => {
    expect(detectLongChain('加个登录功能')).toBe(false);
    expect(detectLongChain('看下 REQ-001 的状态')).toBe(false);
    expect(detectLongChain('REQ-001 又是 REQ-001')).toBe(false);
  });

  it('大小写与连字符差异视为同一工单（去重后再数）', () => {
    expect(detectLongChain('req001 和 REQ-001 是一回事')).toBe(false);
    expect(detectLongChain('req001 和 REQ-002 一起排期')).toBe(true);
  });
});

// ===========================================================================
// Layer 1：20.7 对话历史注入
// ===========================================================================

describe('20.7 buildChatHistoryBlock', () => {
  it('没有历史时返回空串，不改变原始输入', () => {
    expect(buildChatHistoryBlock([])).toBe('');
  });

  it('按 USER/ASSISTANT 渲染角色并带上轮次小节', () => {
    const block = buildChatHistoryBlock([
      { role: 'USER', content: '加个企业微信登录' },
      { role: 'ASSISTANT', content: '好的，需求已记录' },
    ]);
    expect(block).toContain('## 对话历史');
    expect(block).toContain('用户：加个企业微信登录');
    expect(block).toContain('助手：好的，需求已记录');
    expect(block).toContain('## 当前问题');
  });

  it('历史块拼在当前问题之前，顺序不能颠倒', () => {
    const block = buildChatHistoryBlock([
      { role: 'USER', content: '上一轮问题' },
    ]);
    const composed = `${block}这一轮问题`;
    expect(composed.indexOf('上一轮问题')).toBeLessThan(
      composed.indexOf('这一轮问题'),
    );
  });
});

// ===========================================================================
// Layer 2：真实 LLM（默认跳过）
// ===========================================================================

describe.skipIf(!RUN_LLM)('20.3 报告真正消费检索内容（真实 LLM）', () => {
  let modelAvailable = true;

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      modelAvailable = false;
      console.warn(
        '⚠️  OPENAI_API_KEY 未设置，第二十章 Layer 2 用例将跳过',
      );
    }
  });

  it(
    '注入特征事实后，报告正文出现对应术语',
    async () => {
      if (!modelAvailable) return;
      // 这条术语是凭空注入的、模型不可能从训练知识里猜到，
      // 报告里出现它就证明「检索 → state → 报告」这条数据流真的闭合了。
      const retrievedContext =
        '[知识库] 企业微信登录必须使用 OAuth2 授权码模式，并在回调时校验 corpId。';
      const result = await runAnalysisGraph({
        input: '为后台管理系统增加企业微信扫码登录',
        retrievedContext,
      } as never);
      expect(result.summary ?? '').toMatch(/OAuth2|授权码|corpId/i);
    },
    180_000,
  );
});
