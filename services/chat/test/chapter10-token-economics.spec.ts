import { describe, it, expect, vi } from 'vitest';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  estimateTextTokens,
  getModelPricing,
  estimateGraphNodeCost,
  PRICING,
} from '../src/llm/cost/token-estimator.js';
import { trimMessagesForContext } from '../src/llm/context/message-trimmer.js';
import {
  compressConversation,
  type SummaryModel,
} from '../src/llm/context/conversation-compressor.js';
import {
  resolveModelForAgent,
  DEFAULT_AGENT_MODEL_SET,
  HIGH_RISK_AGENTS,
  AGENT_TO_CONFIG_KEY,
  type AgentName,
} from '../src/llm/cost/agent-model-set.js';
import { TokenUsageService } from '../src/llm/cost/token-usage.service.js';
import { withTokenUsage } from '../src/llm/cost/with-token-usage.js';
import { resolveBudgetAction } from '../src/llm/cost/budget-policy.js';

describe('10.2.1 Token 估算器 - estimateTextTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('null/undefined 返回 0', () => {
    expect(estimateTextTokens(null as any)).toBe(0);
    expect(estimateTextTokens(undefined as any)).toBe(0);
  });

  it('中文需求文本能估算出大于 0 的 token', () => {
    const text = '新增批量导入 Excel，支持 10 万行数据校验';
    const tokens = estimateTextTokens(text);
    console.log('  —— 中文文本估算 ——');
    console.log(`  文本: "${text}"`);
    console.log(`  估算 tokens: ${tokens}`);

    expect(tokens).toBe(18);
    expect(tokens).toBeGreaterThan(0);
  });

  it('纯英文文本每 4 字符约 1 token', () => {
    const text = 'Hello World Test';
    const tokens = estimateTextTokens(text);
    console.log('  —— 英文文本估算 ——');
    console.log(`  文本: "${text}" (${text.length} chars)`);
    console.log(`  估算 tokens: ${tokens}`);

    expect(tokens).toBe(4);
  });
});

describe('10.2.1 estimateGraphNodeCost - 节点成本估算', () => {
  it('带 tools 的专家节点成本高于不带 tools 的节点', () => {
    const systemPrompt = '你是需求分析专家，负责评审权限与功能设计。';
    const messages = '用户提出：需要扫码签到与蓝牙围栏联动。';
    const outputText = '评审意见：建议补充离线缓存与补偿机制。';

    const withoutTools = estimateGraphNodeCost({
      nodeName: 'expert_node',
      modelName: 'gpt-4o',
      systemPrompt,
      messages,
      outputText,
    });

    const toolSchemas = JSON.stringify({
      tools: [
        { name: 'verify_fence', description: '校验蓝牙围栏范围' },
        { name: 'export_excel', description: '批量导出签到记录为 Excel' },
      ],
    });

    const withTools = estimateGraphNodeCost({
      nodeName: 'expert_node',
      modelName: 'gpt-4o',
      systemPrompt,
      toolSchemas,
      messages,
      outputText,
    });

    console.log('  —— 工具对成本的影响 ——');
    console.log(`  带 tools: inputTokens=${withTools.inputTokens}, cost=$${withTools.estimatedCostUsd.toFixed(6)}`);
    console.log(`  无 tools: inputTokens=${withoutTools.inputTokens}, cost=$${withoutTools.estimatedCostUsd.toFixed(6)}`);

    expect(withTools.inputTokens).toBeGreaterThan(withoutTools.inputTokens);
    expect(withTools.estimatedCostUsd).toBeGreaterThan(withoutTools.estimatedCostUsd);
  });

  it('output token 按输出价格计算', () => {
    const pricing = getModelPricing('gpt-4o');
    const inputPricePerToken = pricing.input / 1_000_000;
    const outputPricePerToken = pricing.output / 1_000_000;
    const ratio = pricing.output / pricing.input;

    console.log('  —— 输出 vs 输入单价 ——');
    console.log(`  输入单价: $${inputPricePerToken.toFixed(8)}/token`);
    console.log(`  输出单价: $${outputPricePerToken.toFixed(8)}/token`);
    console.log(`  输出比输入贵: ${ratio.toFixed(1)}x`);

    const result = estimateGraphNodeCost({
      nodeName: 'test_node',
      modelName: 'gpt-4o',
      systemPrompt: '1234',
      outputText: 'abcd',
    });

    expect(result.outputTokens).toBe(1);
    expect(ratio).toBe(4.0);
  });
});

describe('10.2.1 getModelPricing - 价格表与百炼模型查询', () => {
  it('正确查询百炼模型价格：针对 qwen3.8-max 和 qwen3.7-flash 别名及全名', () => {
    const qwen38 = getModelPricing('qwen3.8-max');
    expect(qwen38.input).toBe(1.667);
    expect(qwen38.output).toBe(5.0);
    expect(qwen38.cachedInput).toBe(0.208);

    const qwen37Alias = getModelPricing('qwen3.7-flash');
    expect(qwen37Alias.input).toBe(0.028);
    expect(qwen37Alias.output).toBe(0.111);

    const qwen37Full = getModelPricing('qwen3.7-flash-2026-07-15');
    expect(qwen37Full).toEqual(qwen37Alias);

    const dsFlashAlias = getModelPricing('deepseek-v4-flash');
    const dsFlashFull = getModelPricing('deepseek-v4-flash-0731');
    expect(dsFlashAlias.input).toBe(0.208);
    expect(dsFlashAlias).toEqual(dsFlashFull);
  });

  it('未知模型安全回退到 gpt-4o-mini', () => {
    const unknown = getModelPricing('unknown-model');
    expect(unknown).toEqual(PRICING['gpt-4o-mini']);
  });
});

describe('10.5.1 message-trimmer - 消息裁剪与孤立工具消息清理', () => {
  it('保留 system 消息，即使 maxMessages 限制很小', () => {
    const sys = new SystemMessage('系统设定：需求分析主管');
    const h1 = new HumanMessage('第一轮用户需求');
    const a1 = new AIMessage('第一轮专家回复');
    const h2 = new HumanMessage('第二轮用户追问');

    const result = trimMessagesForContext([sys, h1, a1, h2], { maxMessages: 2 });
    expect(result.length).toBe(3);
    expect(result[0]).toBe(sys);
    expect(result[1]).toBe(a1);
    expect(result[2]).toBe(h2);
  });

  it('只保留最近 N 条非系统消息', () => {
    const msgs = [
      new HumanMessage('h1'),
      new AIMessage('a1'),
      new HumanMessage('h2'),
      new AIMessage('a2'),
      new HumanMessage('h3'),
    ];

    const result = trimMessagesForContext(msgs, { maxMessages: 3 });
    expect(result.length).toBe(3);
    expect(result.map((m) => m.content)).toEqual(['h2', 'a2', 'h3']);
  });

  it('删除孤立 ToolMessage（窗口截断后失去对应 AIMessage）', () => {
    const orphanTool = new ToolMessage({
      content: '{"fences":["zone-1","zone-2"]}',
      tool_call_id: 'call_expired_001',
    });
    const currentHuman = new HumanMessage('请给出最终评估报告');

    const result = trimMessagesForContext([orphanTool, currentHuman], { maxMessages: 2 });
    expect(result.length).toBe(1);
    expect(result[0]).toBe(currentHuman);
  });

  it('AIMessage(tool_calls) 与 ToolMessage 成对保留', () => {
    const aiWithTool = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_auth_01', name: 'check_auth', args: {} }],
    });
    const toolMsg = new ToolMessage({
      content: '权限校验通过',
      tool_call_id: 'call_auth_01',
    });
    const nextHuman = new HumanMessage('下一步操作');

    const result = trimMessagesForContext([aiWithTool, toolMsg, nextHuman], { maxMessages: 5 });
    expect(result.length).toBe(3);
    expect(result[0]).toBe(aiWithTool);
    expect(result[1]).toBe(toolMsg);
    expect(result[2]).toBe(nextHuman);
  });

  it('多个 tool_call_id 精确配对，错配的孤立 ToolMessage 被清理', () => {
    const aiWithTool = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_valid_123', name: 'search_db', args: {} }],
    });
    const validTool = new ToolMessage({
      content: '正确结果',
      tool_call_id: 'call_valid_123',
    });
    const orphanTool = new ToolMessage({
      content: '错误孤立结果',
      tool_call_id: 'call_mismatched_999',
    });

    const result = trimMessagesForContext([aiWithTool, validTool, orphanTool], { maxMessages: 5 });
    expect(result.length).toBe(2);
    expect(result[0]).toBe(aiWithTool);
    expect(result[1]).toBe(validTool);
  });

  it('AIMessage 部分 tool_call 缺失响应时整条移除（全有或全无策略）', () => {
    // AIMessage 发起了两个 call，但窗口中只收到 call_1 的响应，缺失 call_2
    const aiWithTwoCalls = new AIMessage({
      content: '',
      tool_calls: [
        { id: 'call_1', name: 'query_user', args: {} },
        { id: 'call_2', name: 'query_order', args: {} },
      ],
    });
    const toolMsg1 = new ToolMessage({
      content: '用户基础信息',
      tool_call_id: 'call_1',
    });
    const nextHuman = new HumanMessage('请汇报状态');

    const result = trimMessagesForContext([aiWithTwoCalls, toolMsg1, nextHuman], { maxMessages: 5 });
    // 全有或全无策略：aiWithTwoCalls 与 toolMsg1 均被剔除，仅保留 nextHuman
    expect(result.length).toBe(1);
    expect(result[0]).toBe(nextHuman);
  });
});

describe('10.5.2 conversation-compressor - 历史对话摘要压缩', () => {
  it('短对话（非系统消息 <= keepRecent）不触发压缩，不调用 summaryModel', async () => {
    const mockModel: SummaryModel = {
      invoke: vi.fn(),
    };
    const msgs = [
      new SystemMessage('系统架构规则'),
      new HumanMessage('需求简述'),
      new AIMessage('初步理解'),
    ];

    const result = await compressConversation(msgs, mockModel, { keepRecent: 5 });
    expect(result).toEqual(msgs);
    expect(mockModel.invoke).not.toHaveBeenCalled();
  });

  it('长对话触发 summaryModel.invoke，返回结果包含 [对话摘要] 前缀', async () => {
    const mockModel: SummaryModel = {
      invoke: vi.fn().mockResolvedValue({
        content: '需求编号 REQ-2026-001：移动端扫码签到与蓝牙围栏联动。',
      }),
    };

    const msgs = [
      new HumanMessage('h1: 提出需求 REQ-2026-001'),
      new AIMessage('a1: 收到需求'),
      new HumanMessage('h2: 增加蓝牙围栏约束'),
      new AIMessage('a2: 已记录围栏逻辑'),
      new HumanMessage('h3: 确认最终方案'),
    ];

    const result = await compressConversation(msgs, mockModel, { keepRecent: 2 });
    expect(mockModel.invoke).toHaveBeenCalledTimes(1);

    // 结构应为：[对话摘要] SystemMessage + 最后的 2 条非系统消息
    expect(result.length).toBe(3);
    expect(result[0] instanceof SystemMessage).toBe(true);
    expect(result[0].content).toContain('[对话摘要]');
    expect(result[0].content).toContain('REQ-2026-001');
    expect(result.slice(1)).toEqual([msgs[3], msgs[4]]);
  });

  it('原始 SystemMessage 始终保留在列表最前，紧接摘要', async () => {
    const mockModel: SummaryModel = {
      invoke: vi.fn().mockResolvedValue({
        content: '需求已澄清，专家准备评审',
      }),
    };

    const sys1 = new SystemMessage('角色：需求专家');
    const sys2 = new SystemMessage('约束：数据跨境合规');
    const h1 = new HumanMessage('h1');
    const a1 = new AIMessage('a1');
    const h2 = new HumanMessage('h2');

    const result = await compressConversation([sys1, sys2, h1, a1, h2], mockModel, { keepRecent: 1 });
    expect(result.length).toBe(4);
    expect(result[0]).toBe(sys1);
    expect(result[1]).toBe(sys2);
    expect(result[2].content).toBe('[对话摘要] 需求已澄清，专家准备评审');
    expect(result[3]).toBe(h2);
  });
});

describe('10.9.1 AgentModelSet - 默认配置与角色模型解析', () => {
  it('默认按角色返回不同 modelConfigId', () => {
    const supervisorRes = resolveModelForAgent({ agentName: 'supervisor' });
    const functionalRes = resolveModelForAgent({ agentName: 'functional_expert' });
    const compressorRes = resolveModelForAgent({ agentName: 'compressor' });

    expect(supervisorRes.selectedModelConfigId).toBe(
      DEFAULT_AGENT_MODEL_SET.supervisorModelConfigId,
    );
    expect(supervisorRes.overrideReason).toBeNull();

    expect(functionalRes.selectedModelConfigId).toBe(
      DEFAULT_AGENT_MODEL_SET.functionalModelConfigId,
    );
    expect(functionalRes.overrideReason).toBeNull();

    expect(compressorRes.selectedModelConfigId).toBe(
      DEFAULT_AGENT_MODEL_SET.compressorModelConfigId,
    );
    expect(compressorRes.overrideReason).toBeNull();

    expect(supervisorRes.selectedModelConfigId).not.toBe(functionalRes.selectedModelConfigId);
    expect(functionalRes.selectedModelConfigId).not.toBe(compressorRes.selectedModelConfigId);
  });

  it('高风险 5 个角色默认均为强模型', () => {
    const highRiskExpected: AgentName[] = [
      'supervisor',
      'security_expert',
      'compliance_expert',
      'critic',
      'summary_agent',
    ];
    expect(HIGH_RISK_AGENTS).toEqual(highRiskExpected);

    for (const agent of highRiskExpected) {
      const res = resolveModelForAgent({ agentName: agent });
      expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET.supervisorModelConfigId);
      expect(res.overrideReason).toBeNull();
    }
  });

  it('未登记的 agentName 回退 functional 模型并标记 unknown agent', () => {
    const res = resolveModelForAgent({ agentName: 'not_registered_agent' as AgentName });

    expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET.functionalModelConfigId);
    expect(res.selectedModelConfigId).toBeTruthy();
    expect(res.overrideReason).toContain('unknown agent');
  });

  it('低复杂度时 functional 降级到 compressor 模型并附 overrideReason 含 low_complexity', () => {
    const res = resolveModelForAgent({
      agentName: 'functional_expert',
      requirementComplexity: 'low',
    });

    expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET.compressorModelConfigId);
    expect(res.overrideReason).toContain('low_complexity');
    expect(res.overrideReason).toBe('low_complexity_downgrade');
  });
});

describe('10.9.2 运行时模型覆盖 - 预算与风险控制', () => {
  it('85% 预算时 functional 降级到 compressorModelConfigId', () => {
    const res = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 85 },
    });

    expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET.compressorModelConfigId);
    expect(res.overrideReason).toBe('budget_tight_downgrade (85%)');
  });

  it('90% 预算时 security 仍是强模型且 reason 为 null', () => {
    const res = resolveModelForAgent({
      agentName: 'security_expert',
      budgetStatus: { usedPercent: 90 },
    });

    expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET.supervisorModelConfigId);
    expect(res.overrideReason).toBeNull();
  });

  it('110% 预算时返回 budget_exceeded_reject reason', () => {
    const agentsToTest: AgentName[] = [
      'supervisor',
      'functional_expert',
      'security_expert',
      'critic',
    ];
    for (const agent of agentsToTest) {
      const res = resolveModelForAgent({
        agentName: agent,
        budgetStatus: { usedPercent: 110 },
      });
      expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET[AGENT_TO_CONFIG_KEY[agent]]);
      expect(res.overrideReason).toBe('budget_exceeded_reject');
    }
  });

  it('110% 预算时 compressor 仍可用且 reason=null (豁免机制)', () => {
    const res = resolveModelForAgent({
      agentName: 'compressor',
      budgetStatus: { usedPercent: 110 },
    });

    expect(res.selectedModelConfigId).toBe(DEFAULT_AGENT_MODEL_SET.compressorModelConfigId);
    expect(res.overrideReason).toBeNull();
  });

  it('任何 override 路径 overrideReason 均不为空', () => {
    // 路径 1: 预算超限 (非 compressor)
    const rejectRes = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 105 },
    });
    expect(rejectRes.overrideReason).not.toBeNull();
    expect(rejectRes.overrideReason?.length).toBeGreaterThan(0);

    // 路径 2: 预算紧张降级 (80%-99%)
    const tightRes = resolveModelForAgent({
      agentName: 'performance_expert',
      budgetStatus: { usedPercent: 82 },
    });
    expect(tightRes.overrideReason).not.toBeNull();
    expect(tightRes.overrideReason?.length).toBeGreaterThan(0);

    // 路径 3: 低复杂度降级
    const lowComplexityRes = resolveModelForAgent({
      agentName: 'risk_agent',
      requirementComplexity: 'low',
    });
    expect(lowComplexityRes.overrideReason).not.toBeNull();
    expect(lowComplexityRes.overrideReason?.length).toBeGreaterThan(0);

    // 兜底正常路径应为 null
    const normalRes = resolveModelForAgent({
      agentName: 'performance_expert',
      budgetStatus: { usedPercent: 50 },
      requirementComplexity: 'medium',
    });
    expect(normalRes.overrideReason).toBeNull();
  });
});

describe('10.8.2 TokenUsageService - 节点使用量持久化与统计', () => {
  it('recordUsage 成功写入完整字段，totalTokens 缺省时自动求和', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'usage_123' });
    const mockPrisma = {
      tokenUsage: {
        create: mockCreate,
      },
    } as any;

    const service = new TokenUsageService(mockPrisma);
    await service.recordUsage({
      graphName: 'requirement_analysis',
      nodeName: 'security_node',
      agentName: 'security_expert',
      modelName: 'gpt-4o',
      modelConfigId: DEFAULT_AGENT_MODEL_SET.supervisorModelConfigId,
      inputTokens: 100,
      outputTokens: 50,
      // totalTokens 未传，自动求和兜底
      cachedInputTokens: 20,
      estimatedCostUsd: 0.00075,
      latencyMs: 320,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.data.graphName).toBe('requirement_analysis');
    expect(callArg.data.agentName).toBe('security_expert');
    expect(callArg.data.inputTokens).toBe(100);
    expect(callArg.data.outputTokens).toBe(50);
    expect(callArg.data.totalTokens).toBe(150); // 100 + 50
    expect(callArg.data.provider).toBe('openai');
  });

  it('getMonthlyStats 正确按当月汇总各项 Token 与成本', async () => {
    const mockRecords = [
      { estimatedCostUsd: 0.05, inputTokens: 1000, outputTokens: 200, cachedInputTokens: 500 },
      { estimatedCostUsd: 0.03, inputTokens: 500, outputTokens: 100, cachedInputTokens: 100 },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockRecords);
    const mockPrisma = {
      tokenUsage: {
        findMany: mockFindMany,
      },
    } as any;

    const service = new TokenUsageService(mockPrisma);
    const stats = await service.getMonthlyStats();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(stats.totalCost).toBeCloseTo(0.08);
    expect(stats.totalInputTokens).toBe(1500);
    expect(stats.totalOutputTokens).toBe(300);
    expect(stats.totalCachedTokens).toBe(600);
    expect(stats.calls).toBe(2);
  });

  it('按 nodeName 与 agentName 聚合并按成本降序排序', async () => {
    const mockRecords = [
      { nodeName: 'node_b', agentName: 'functional_expert', estimatedCostUsd: 0.02 },
      { nodeName: 'node_a', agentName: 'security_expert', estimatedCostUsd: 0.10 },
      { nodeName: 'node_b', agentName: 'functional_expert', estimatedCostUsd: 0.03 },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockRecords);
    const mockPrisma = {
      tokenUsage: {
        findMany: mockFindMany,
      },
    } as any;

    const service = new TokenUsageService(mockPrisma);

    const nodeStats = await service.getStatsByNode();
    expect(nodeStats.length).toBe(2);
    expect(nodeStats[0].nodeName).toBe('node_a');
    expect(nodeStats[0].totalCost).toBeCloseTo(0.10);
    expect(nodeStats[0].calls).toBe(1);
    expect(nodeStats[1].nodeName).toBe('node_b');
    expect(nodeStats[1].totalCost).toBeCloseTo(0.05);
    expect(nodeStats[1].calls).toBe(2);

    const agentStats = await service.getStatsByAgent();
    expect(agentStats.length).toBe(2);
    expect(agentStats[0].agentName).toBe('security_expert');
    expect(agentStats[0].totalCost).toBeCloseTo(0.10);
    expect(agentStats[1].agentName).toBe('functional_expert');
    expect(agentStats[1].totalCost).toBeCloseTo(0.05);
  });

  it('isOverBudget 正确对比预算上限', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      { estimatedCostUsd: 15.5, inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0 },
    ]);
    const mockPrisma = {
      tokenUsage: {
        findMany: mockFindMany,
      },
    } as any;

    const service = new TokenUsageService(mockPrisma);
    expect(await service.isOverBudget(10.0)).toBe(true);
    expect(await service.isOverBudget(20.0)).toBe(false);
  });

  it('prisma 抛异常时 recordUsage 不向上抛错（侧路容错）', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('DB connection lost'));
    const mockPrisma = {
      tokenUsage: {
        create: mockCreate,
      },
    } as any;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new TokenUsageService(mockPrisma);

    await expect(
      service.recordUsage({
        graphName: 'g',
        nodeName: 'n',
        agentName: 'a',
        modelName: 'm',
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('10.8.3 withTokenUsage - 模型调用侧路包装器', () => {
  it('response 带 usage metadata 时精确记录 input/output/cached 且 isEstimated 为 false', async () => {
    const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
    const mockService = { recordUsage: mockRecordUsage } as unknown as TokenUsageService;

    const fakeResponse = {
      content: '安全评审意见已生成',
      usage_metadata: {
        input_tokens: 1200,
        output_tokens: 300,
        input_token_details: { cache_read: 400 },
      },
    };

    const res = await withTokenUsage(
      {
        graphName: 'req_graph',
        nodeName: 'security_node',
        agentName: 'security_expert',
        modelName: 'gpt-4o',
      },
      mockService,
      async () => fakeResponse,
    );

    expect(res).toBe(fakeResponse);
    expect(mockRecordUsage).toHaveBeenCalledTimes(1);

    const record = mockRecordUsage.mock.calls[0][0];
    expect(record.inputTokens).toBe(1200);
    expect(record.outputTokens).toBe(300);
    expect(record.cachedInputTokens).toBe(400);
    expect(record.isEstimated).toBe(false);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('response 不带 metadata 时回退至估算 input = output * 5 且 isEstimated 为 true', async () => {
    const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
    const mockService = { recordUsage: mockRecordUsage } as unknown as TokenUsageService;

    const fakeResponse = {
      content: '这是一条包含二十个中文字符的回复内容测试用例呀',
    };
    const expectedOutputTokens = estimateTextTokens(fakeResponse.content);

    const res = await withTokenUsage(
      {
        graphName: 'req_graph',
        nodeName: 'func_node',
        agentName: 'functional_expert',
        modelName: 'gpt-4o-mini',
      },
      mockService,
      async () => fakeResponse,
    );

    expect(res).toBe(fakeResponse);
    expect(mockRecordUsage).toHaveBeenCalledTimes(1);

    const record = mockRecordUsage.mock.calls[0][0];
    expect(record.outputTokens).toBe(expectedOutputTokens);
    expect(record.inputTokens).toBe(expectedOutputTokens * 5);
    expect(record.cachedInputTokens).toBe(0);
    expect(record.isEstimated).toBe(true);
  });

  it('recordUsage 抛错时仍正常返回模型响应（侧路隔离）', async () => {
    const mockRecordUsage = vi.fn().mockRejectedValue(new Error('Network error on DB write'));
    const mockService = { recordUsage: mockRecordUsage } as unknown as TokenUsageService;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeResponse = { content: '正常返回结果' };

    const res = await withTokenUsage(
      {
        graphName: 'req_graph',
        nodeName: 'critic_node',
        agentName: 'critic',
        modelName: 'gpt-4o',
      },
      mockService,
      async () => fakeResponse,
    );

    expect(res).toBe(fakeResponse);
    warnSpy.mockRestore();
  });

  it('usageService 为 null 时跳过记录并原样返回执行结果', async () => {
    const fakeResponse = { content: '直接返回' };
    const fn = vi.fn().mockResolvedValue(fakeResponse);

    const res = await withTokenUsage(
      {
        graphName: 'req_graph',
        nodeName: 'test_node',
        agentName: 'test_agent',
        modelName: 'gpt-4o',
      },
      null,
      fn,
    );

    expect(res).toBe(fakeResponse);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('10.9.3 预算动作选择 - resolveBudgetAction', () => {
  it('50% 预算 → allow', () => {
    const res = resolveBudgetAction({
      budgetUsedPercent: 50,
      agentName: 'functional_expert',
    });
    expect(res.action).toBe('allow');
    expect(res.reason).toBe('budget OK (50%)');
  });

  it('85% 预算 + functional → downgrade，reason 含 85', () => {
    const res = resolveBudgetAction({
      budgetUsedPercent: 85,
      agentName: 'functional_expert',
    });
    expect(res.action).toBe('downgrade');
    expect(res.reason).toContain('85');
    expect(res.reason).toBe('budget tight, low-risk agent can downgrade (85%)');
  });

  it('90% 预算 + security_expert → allow（高风险不降级）', () => {
    const res = resolveBudgetAction({
      budgetUsedPercent: 90,
      agentName: 'security_expert',
    });
    expect(res.action).toBe('allow');
    expect(res.reason).toBe('high-risk agent, no downgrade (90%)');
  });

  it('110% 预算 + risk_agent → reject', () => {
    const res = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: 'risk_agent',
    });
    expect(res.action).toBe('reject');
    expect(res.reason).toBe('budget exceeded (110%)');
  });

  it('110% 预算 + compressor → allow（豁免）', () => {
    const res = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: 'compressor',
    });
    expect(res.action).toBe('allow');
    expect(res.reason).toBe('compressor allowed even over budget (cost reduction purpose)');
  });
});

describe('10.3 Multi-Agent 节点成本拆账', () => {
  it('能聚合多节点 usage 并找出最贵节点', () => {
    // 取自 10.2 的九个步骤中具有代表性的五个节点，用量口径一致
    const nodes = [
      { nodeName: 'supervisor', inputTokens: 1500, outputTokens: 100 },
      { nodeName: 'functional_expert', inputTokens: 3000, outputTokens: 600 },
      { nodeName: 'performance_expert', inputTokens: 2200, outputTokens: 500 },
      { nodeName: 'security_expert', inputTokens: 4500, outputTokens: 800 },
      { nodeName: 'aggregator', inputTokens: 1800, outputTokens: 200 },
      { nodeName: 'summary_critic', inputTokens: 5000, outputTokens: 1200 },
    ];

    const pricing = getModelPricing('qwen3.8-max');
    const costs = nodes.map((n) => ({
      nodeName: n.nodeName,
      inputTokens: n.inputTokens,
      outputTokens: n.outputTokens,
      cost:
        (n.inputTokens / 1_000_000) * pricing.input +
        (n.outputTokens / 1_000_000) * pricing.output,
    }));

    const totalCost = costs.reduce((s, c) => s + c.cost, 0);
    const totalInput = nodes.reduce((s, n) => s + n.inputTokens, 0);
    const totalOutput = nodes.reduce((s, n) => s + n.outputTokens, 0);
    const sorted = [...costs].sort((a, b) => b.cost - a.cost);

    console.log('—— 节点成本拆账 ——');
    for (const c of sorted) {
      console.log(
        `  ${c.nodeName}: $${c.cost.toFixed(6)} (in=${c.inputTokens}, out=${c.outputTokens})`,
      );
    }
    console.log(`  总计: $${totalCost.toFixed(6)} (in=${totalInput}, out=${totalOutput})`);

    expect(sorted.length).toBe(nodes.length);
    expect(totalCost).toBeGreaterThan(0);
    // 读全量前序上下文的总结节点 + 工具循环最多的安全专家，应排在最贵的前两位
    expect(sorted[0].nodeName).toBe('summary_critic');
    expect(['summary_critic', 'security_expert']).toContain(sorted[1].nodeName);
    expect(sorted[sorted.length - 1].nodeName).toBe('supervisor');
    // 成本为各节点之和：排序不改变汇总值
    expect(sorted.reduce((s, c) => s + c.cost, 0)).toBeCloseTo(totalCost);
  });

  it('同一批用量在不同模型档位下的成本差（分级策略的收益量化）', () => {
    // 档位映射见 setup-demo-db.ts：strong=qwen3.8-max / medium=deepseek-v4-flash / weak=qwen3.7-flash
    // 注意百炼单价不按参数量单调，档位必须按 PRICING 实际单价排。
    const usage = { inputTokens: 23700, outputTokens: 4080 };

    const costOf = (modelName: string) => {
      const p = getModelPricing(modelName);
      return (
        (usage.inputTokens / 1_000_000) * p.input +
        (usage.outputTokens / 1_000_000) * p.output
      );
    };

    const strong = costOf('qwen3.8-max');
    const medium = costOf('deepseek-v4-flash');
    const weak = costOf('qwen3.7-flash-2026-07-15');

    console.log('—— 模型档位成本对比（10.2 的 23,700 in / 4,080 out）——');
    console.log(`  strong qwen3.8-max       : $${strong.toFixed(6)}`);
    console.log(`  medium deepseek-v4-flash : $${medium.toFixed(6)}`);
    console.log(`  weak   qwen3.7-flash     : $${weak.toFixed(6)}`);
    console.log(`  强/弱倍率                : ${(strong / weak).toFixed(1)}x`);

    // 降级必须真的更便宜，否则"预算紧张就降级"失去意义
    expect(strong).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(weak);
    expect(strong / weak).toBeGreaterThan(10);
  });
});

describe('10.6.4 Prompt Caching 稳定前缀', () => {
  const longestCommonPrefixLength = (a: string, b: string): number => {
    let len = 0;
    const max = Math.min(a.length, b.length);
    while (len < max && a[len] === b[len]) len++;
    return len;
  };

  it('system prompt + tools 放前缀位置时保持稳定', () => {
    const systemPrompt = '你是需求分析专家。';
    const toolDefs = JSON.stringify([{ name: 'search', description: '搜索需求库' }]);

    // 正确顺序：system → tools → history → input
    const call1 = [systemPrompt, toolDefs, '用户问题1'].join('|');
    const call2 = [systemPrompt, toolDefs, '用户问题2'].join('|');

    const prefixLen = longestCommonPrefixLength(call1, call2);
    const stableTokens = estimateTextTokens(call1.substring(0, prefixLen));
    const totalTokens = estimateTextTokens(call1);

    console.log('—— 前缀稳定性 ——');
    console.log(`  稳定前缀 tokens: ${stableTokens}`);
    console.log(`  总 tokens: ${totalTokens}`);
    console.log(`  缓存命中率: ${((stableTokens / totalTokens) * 100).toFixed(1)}%`);

    expect(stableTokens).toBeGreaterThan(0);
    // 前缀必须覆盖 system + tools，命中率才有意义
    expect(stableTokens).toBeGreaterThanOrEqual(
      estimateTextTokens(systemPrompt + toolDefs),
    );
  });

  it('用户输入放前面会破坏前缀稳定性', () => {
    const systemPrompt = '你是需求分析专家。';

    // 错误顺序：input → system
    const bad1 = ['用户问题1', systemPrompt].join('|');
    const bad2 = ['用户问题2', systemPrompt].join('|');
    const badPrefixLen = longestCommonPrefixLength(bad1, bad2);

    // 正确顺序：system → input
    const good1 = [systemPrompt, '用户问题1'].join('|');
    const good2 = [systemPrompt, '用户问题2'].join('|');
    const goodPrefixLen = longestCommonPrefixLength(good1, good2);

    console.log('—— 前缀顺序对比 ——');
    console.log(`  正确顺序 (system 先): 公共前缀 ${goodPrefixLen} chars`);
    console.log(`  错误顺序 (input 先):  公共前缀 ${badPrefixLen} chars`);

    expect(goodPrefixLen).toBeGreaterThan(badPrefixLen);
    // system 在前时公共前缀至少覆盖整个 system prompt
    expect(goodPrefixLen).toBeGreaterThanOrEqual(systemPrompt.length);
  });
});

