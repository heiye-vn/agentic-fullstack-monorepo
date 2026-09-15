import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  RequirementAnalysisState,
  createAnalysisGraph,
  createAnalysisSubGraph,
  createSummarySubGraph,
  runAnalysisGraph,
  streamAnalysisGraph,
  normalizeAnalysisInput,
  extractNode,
  clarifyNode,
  analysisNode,
  riskNode,
  summaryNode,
  criticNode,
  shouldRefine,
  shouldCallTools,
  finalizeNode,
  getAnalysisGraphMermaid,
  getAnalysisSubGraphMermaid,
  getSummarySubGraphMermaid,
  analysisTools,
  searchRequirementTool,
  checkConflictsTool,
  type RequirementAnalysisStateType,
} from '../src/llm/graph/requirement-analysis-graph.js';
import {
  runLegacyAnalysisChain,
  runRequirementAnalysis,
} from '../src/llm/agents/requirement-analysis.js';
import type { SubAgents } from '../src/llm/agents/sub-agents.js';

describe('Requirement Analysis LangGraph Migration Spec', () => {
  const TEST_INPUT =
    '开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文';

  let mockSubAgents: SubAgents;
  const mockExtractionJson = JSON.stringify({
    action: '开发会话记忆系统',
    targetUsers: ['需求分析师'],
    coreFeature: '多轮澄清并自动裁剪长对话上下文',
    constraints: ['长上下文自动截断', '保证关键信息不丢失'],
    priority: 'high',
    isComplete: true,
  });

  const mockClarificationJson = JSON.stringify({
    needsClarification: false,
    questions: [],
    clarificationQuestions: [],
    reason: '需求信息完整且目标清晰',
  });

  const mockAnalysisText =
    '### 架构多维分析\n1. 功能分解：状态机、会话窗口；\n2. 验收标准：支持精准 Token 裁剪。';
  const mockRiskText =
    '### 风险评估\n1. 风险点：长对话摘要丢失核心槽位；\n2. 规避对策：双层滑动窗口结合。';
  const mockSummaryText =
    '# 最终需求规格说明书 (SRS)\n本项目旨在开发面向需求分析师的会话记忆系统，核心涵盖澄清与裁剪。';

  beforeEach(() => {
    mockSubAgents = {
      extractAgent: {
        invoke: vi.fn().mockResolvedValue(mockExtractionJson),
      } as any,
      clarifyAgent: {
        invoke: vi.fn().mockResolvedValue(mockClarificationJson),
      } as any,
      analysisAgent: {
        invoke: vi.fn().mockResolvedValue(mockAnalysisText),
      } as any,
      riskAgent: {
        invoke: vi.fn().mockResolvedValue(mockRiskText),
      } as any,
      summaryAgent: {
        invoke: vi.fn().mockResolvedValue(mockSummaryText),
      } as any,
    };
  });

  describe('1. State 定义与通道验证 (RequirementAnalysisState)', () => {
    it('应成功定义状态图 Root 并包含所有规定属性通道', () => {
      expect(RequirementAnalysisState).toBeDefined();
      expect(RequirementAnalysisState.spec).toBeDefined();

      const channels = Object.keys(RequirementAnalysisState.spec);
      expect(channels).toContain('messages');
      expect(channels).toContain('extracted');
      expect(channels).toContain('clarified');
      expect(channels).toContain('analysis');
      expect(channels).toContain('analysisResult');
      expect(channels).toContain('risk');
      expect(channels).toContain('riskResult');
      expect(channels).toContain('summary');
      expect(channels).toContain('toolLoopCount');
      expect(channels).toContain('critique');
      expect(channels).toContain('reviseCount');
      expect(channels).toContain('summaryDraft');
    });
  });

  describe('2. 五个原子节点单测 (extract / clarify / analysis / risk / summary)', () => {
    it('extractNode 应正确抽取并返回 Partial<State>', async () => {
      const state = {
        messages: [new HumanMessage(TEST_INPUT)],
        extracted: {},
        clarified: {},
        analysis: '',
        risk: '',
        summary: '',
      } as RequirementAnalysisStateType;

      const result = await extractNode(state, mockSubAgents);
      expect(result).toHaveProperty('extracted');
      expect(result.extracted?.action).toBe('开发会话记忆系统');
      expect(mockSubAgents.extractAgent.invoke).toHaveBeenCalledWith({
        input: TEST_INPUT,
        history: [],
      });
    });

    it('clarifyNode 应正确调用澄清 Agent 并返回 Partial<State>', async () => {
      const state = {
        messages: [new HumanMessage(TEST_INPUT)],
        extracted: { action: '开发会话记忆系统' },
        clarified: {},
        analysis: '',
        risk: '',
        summary: '',
      } as RequirementAnalysisStateType;

      const result = await clarifyNode(state, mockSubAgents);
      expect(result).toHaveProperty('clarified');
      expect(result.clarified?.needsClarification).toBe(false);
      expect(mockSubAgents.clarifyAgent.invoke).toHaveBeenCalled();
    });

    it('analysisNode 应正确生成多维分析并返回 Partial<State>', async () => {
      const state = {
        messages: [new HumanMessage(TEST_INPUT)],
        extracted: { action: '开发会话记忆系统' },
        clarified: { needsClarification: false },
        analysis: '',
        risk: '',
        summary: '',
      } as RequirementAnalysisStateType;

      const result = await analysisNode(state, mockSubAgents);
      expect(result.analysis).toBe(mockAnalysisText);
      expect(mockSubAgents.analysisAgent.invoke).toHaveBeenCalled();
    });

    it('riskNode 应正确评估风险并返回 Partial<State>', async () => {
      const state = {
        messages: [new HumanMessage(TEST_INPUT)],
        extracted: { action: '开发会话记忆系统' },
        clarified: { needsClarification: false },
        analysis: mockAnalysisText,
        risk: '',
        summary: '',
      } as RequirementAnalysisStateType;

      const result = await riskNode(state, mockSubAgents);
      expect(result.risk).toBe(mockRiskText);
      expect(mockSubAgents.riskAgent.invoke).toHaveBeenCalled();
    });

    it('summaryNode 应正确汇总报告并返回 Partial<State>', async () => {
      const state = {
        messages: [new HumanMessage(TEST_INPUT)],
        extracted: { action: '开发会话记忆系统' },
        clarified: { needsClarification: false },
        analysis: mockAnalysisText,
        risk: mockRiskText,
        summary: '',
      } as RequirementAnalysisStateType;

      const result = await summaryNode(state, mockSubAgents);
      expect(result.summary).toBe(mockSummaryText);
      expect(mockSubAgents.summaryAgent.invoke).toHaveBeenCalled();
    });
  });

  describe('3. 图构建与执行 (createAnalysisGraph & runAnalysisGraph)', () => {
    it('createAnalysisGraph 应成功构建并编译线性拓扑图', () => {
      const graph = createAnalysisGraph({ subAgents: mockSubAgents });
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe('function');
    });

    it('runAnalysisGraph 应支持纯字符串输入并跑通完整图流程', async () => {
      const result = await runAnalysisGraph(TEST_INPUT, {
        subAgents: mockSubAgents,
      });

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.extracted?.action).toBe('开发会话记忆系统');
      expect(result.clarified?.needsClarification).toBe(false);
      expect(result.analysis).toBe(mockAnalysisText);
      expect(result.risk).toBe(mockRiskText);
      expect(result.summary).toBe(mockSummaryText);
    });

    it('runAnalysisGraph 应支持 { messages } 对象格式输入', async () => {
      const result = await runAnalysisGraph(
        { messages: [new HumanMessage(TEST_INPUT)] },
        { subAgents: mockSubAgents },
      );

      expect(result.summary).toBe(mockSummaryText);
      expect(result.extracted?.coreFeature).toBe(
        '多轮澄清并自动裁剪长对话上下文',
      );
    });
  });

  describe('4. 核心对齐验证：新图 summary 与旧 Promise 链 100% 一致', () => {
    it('在相同的输入与 Agent 返回下，新图各字段特别是 summary 与旧链保持严格一致', async () => {
      // 1. 运行第六章原有的旧版 Promise 链
      const legacyResult = await runLegacyAnalysisChain(TEST_INPUT, {
        subAgents: mockSubAgents,
      });

      // 2. 运行新的 LangGraph 状态图
      const graphResult = await runAnalysisGraph(TEST_INPUT, {
        subAgents: mockSubAgents,
      });

      // 3. 运行保留的 Ch6 入口函数（转调新图）
      const ch6EntryResult = await runRequirementAnalysis(TEST_INPUT, {
        subAgents: mockSubAgents,
      });

      // 核心验证断言
      expect(graphResult.summary).toBe(legacyResult.summary);
      expect(ch6EntryResult.summary).toBe(legacyResult.summary);
      expect(graphResult.summary).toBe(mockSummaryText);

      // 中间业务字段一致性比对
      expect(graphResult.extracted).toEqual(legacyResult.extracted);
      expect(graphResult.clarified).toEqual(legacyResult.clarified);
      expect(graphResult.analysis).toBe(legacyResult.analysis);
      expect(graphResult.risk).toBe(legacyResult.risk);
    });

    it('应能正确生成并输出图的 Mermaid 流程图代码', () => {
      const mermaidCode = getAnalysisGraphMermaid({ subAgents: mockSubAgents });

      expect(typeof mermaidCode).toBe('string');
      expect(mermaidCode).toContain('graph TD;');
      expect(mermaidCode).toContain('__start__ --> classifier;');
      expect(mermaidCode).toContain('extractStep --> clarifyStep;');
      expect(mermaidCode).toContain('clarifyStep --> analysisStep;');
      expect(mermaidCode).toContain('clarifyStep --> riskStep;');
      expect(mermaidCode).toContain('analysisStep --> summaryStep;');
      expect(mermaidCode).toContain('riskStep --> summaryStep;');
      expect(mermaidCode).toContain('summaryStep --> __end__;');
      expect(mermaidCode).toContain('queryHandler --> __end__;');
      expect(mermaidCode).toContain('chatHandler --> __end__;');
    });
  });

  describe('5. 8.5 ReAct 分析子图专项验证 (createAnalysisSubGraph & toolLoopCount)', () => {
    it('analysisTools 应包含 search_requirement 与 check_conflicts 工具并正确执行', async () => {
      expect(analysisTools.length).toBe(2);
      expect(searchRequirementTool.name).toBe('search_requirement');
      expect(checkConflictsTool.name).toBe('check_conflicts');

      // 验证 search_requirement 工具
      const searchResStr = await searchRequirementTool.invoke({ reqId: 'REQ-20240315-001' });
      const searchRes = JSON.parse(searchResStr);
      expect(searchRes.success).toBe(true);
      expect(searchRes.reqId).toBe('REQ-20240315-001');

      // 验证 check_conflicts 工具针对登录认证需求的检测
      const conflictResStr = await checkConflictsTool.invoke({
        description: '新增统一用户登录认证模块并支持单点登录 SSO',
      });
      const conflictRes = JSON.parse(conflictResStr);
      expect(conflictRes.hasConflict).toBe(true);
      expect(conflictRes.conflictType).toBe('AUTH_ARCHITECTURE_DEPENDENCY');

      // 验证普通需求无冲突
      const normalResStr = await checkConflictsTool.invoke({
        description: '新增问卷题型排序展示功能',
      });
      const normalRes = JSON.parse(normalResStr);
      expect(normalRes.hasConflict).toBe(false);
    });

    it('shouldCallTools 应正确根据 tool_calls 与 6 轮硬上限进行条件分支路由', () => {
      // 场景 A: 无 tool_calls -> finalize
      const normalMsg = new AIMessage({ content: '需求多维分析结论如下' });
      expect(
        shouldCallTools({
          messages: [normalMsg],
          toolLoopCount: 0,
        } as any),
      ).toBe('finalize');

      // 场景 B: 存在 tool_calls 且轮次 < 6 -> tools
      const toolCallMsg = new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            name: 'search_requirement',
            args: { reqId: 'REQ-001' },
          },
        ],
      });
      expect(
        shouldCallTools({
          messages: [toolCallMsg],
          toolLoopCount: 1,
        } as any),
      ).toBe('tools');

      // 场景 C: 即使存在 tool_calls，但 toolLoopCount >= 6 -> 强制 finalize 防死循环
      expect(
        shouldCallTools({
          messages: [toolCallMsg],
          toolLoopCount: 6,
        } as any),
      ).toBe('finalize');
    });

    it('finalizeNode 应能正确提取最后一条 AI 消息内容，并在为空时安全降级', async () => {
      // 正常提取场景
      const validMsg = new AIMessage('### 多维分析结论：功能分解与用户故事完成');
      const validState = {
        messages: [validMsg],
      } as any;
      const res1 = await finalizeNode(validState);
      expect(res1.analysisResult).toBe('### 多维分析结论：功能分解与用户故事完成');
      expect(res1.analysis).toBe('### 多维分析结论：功能分解与用户故事完成');

      // 消息为空触发安全降级场景
      const emptyMsg = new AIMessage('');
      const emptyState = {
        messages: [emptyMsg],
      } as any;
      const res2 = await finalizeNode(emptyState);
      expect(res2.analysisResult).toContain('安全降级');
      expect(res2.analysisResult).toContain('功能分解');
      expect(res2.analysisResult).toContain('验收标准');
    });

    it('createAnalysisSubGraph 独立运行并在持续工具调用时 6 轮强制截断', async () => {
      let invocations = 0;
      const mockLoopModel: any = {
        bindTools: () => mockLoopModel,
        invoke: async () => {
          invocations++;
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                id: `call_${invocations}`,
                name: 'search_requirement',
                args: { reqId: 'REQ-LOOP-TEST' },
              },
            ],
          });
        },
      };

      const subGraph = createAnalysisSubGraph({ model: mockLoopModel });
      const result = await subGraph.invoke({
        messages: [new HumanMessage('测试无限循环')],
        toolLoopCount: 0,
      });

      // 验证循环上限被截断
      expect(result.toolLoopCount).toBeGreaterThanOrEqual(6);
      expect(result.analysisResult).toBeDefined();
      expect(result.analysisResult).toContain('安全降级');
    });

    it('getAnalysisSubGraphMermaid 应能正确导出子图流程图拓扑', () => {
      const mermaid = getAnalysisSubGraphMermaid();
      expect(typeof mermaid).toBe('string');
      expect(mermaid).toContain('__start__ --> agent;');
      expect(mermaid).toContain('tools --> agent;');
      expect(mermaid).toContain('finalize --> __end__;');
    });
  });

  describe('6. 8.6 Critic-Refine 汇总子图专项验证 (createSummarySubGraph & reviseCount)', () => {
    it('shouldRefine 应根据 critique 与 reviseCount 精确判断条件分支与硬上限', () => {
      // 场景 A: critique 为空字符串 -> 直接通过进入 END
      expect(
        shouldRefine({
          critique: '',
          reviseCount: 0,
        } as any),
      ).toBe('__end__');

      // 场景 B: critique 存在且 reviseCount < 2 -> 走向 refine
      expect(
        shouldRefine({
          critique: '排期章节缺少前后依赖关系',
          reviseCount: 1,
        } as any),
      ).toBe('refine');

      // 场景 C: reviseCount >= 2 -> 触发硬上限强制进入 END 防死循环
      expect(
        shouldRefine({
          critique: '依然存在瑕疵',
          reviseCount: 2,
        } as any),
      ).toBe('__end__');

      expect(
        shouldRefine({
          critique: '持续未通过',
          reviseCount: 5,
        } as any),
      ).toBe('__end__');
    });

    it('criticNode 能够识别缺失章节并在降级模式下给出明确指导', async () => {
      // 场景 1: 结构化评审通过
      const passState = {
        summary: `## 需求摘要\n本系统提供统一会话记忆。\n## 冲突分析\n无冲突。\n## 技术复杂度\n评估为中等。\n## 开发排期\n1. 后端3天；2. 前端2天依赖后端完成。`,
      } as any;
      const mockPassCriticModel: any = {
        withStructuredOutput: () => ({
          invoke: async () => ({
            pass: true,
            critique: '',
            issues: [],
          }),
        }),
      };
      const res1 = await criticNode(passState, { model: mockPassCriticModel });
      expect(res1.critique).toBe('');

      // 场景 2: 缺少关键章节并触发降级兜底
      const incompleteReport = `## 简单概述\n仅有这几句描述。`;
      const failState = {
        summary: incompleteReport,
      } as any;
      const mockFailFallbackModel: any = {
        withStructuredOutput: () => {
          throw new Error('API 不支持结构化输出');
        },
      };
      const res2 = await criticNode(failState, { model: mockFailFallbackModel });
      expect(res2.critique).toBeTruthy();
      expect(res2.critique).toContain('缺少必需章节');
    });

    it('createSummarySubGraph 独立运行并在持续被批评时触发 2 次硬上限拦截', async () => {
      // 构造一个始终指出问题并要求修订的 Mock 模型
      let refineTimes = 0;
      const pickyMockModel: any = {
        withStructuredOutput: () => ({
          invoke: async () => ({
            pass: false,
            critique: '排期缺少前后端依赖说明，请补充',
          }),
        }),
        invoke: async () => {
          refineTimes++;
          return new AIMessage({
            content: `### 修订后需求报告 (第 ${refineTimes} 版)\n包含摘要、冲突、复杂度与排期。`,
          });
        },
      };

      const summarySubGraph = createSummarySubGraph(pickyMockModel);
      const result = await summarySubGraph.invoke({
        messages: [new HumanMessage('测试 Critic-Refine 循环硬截断')],
        extracted: { action: '测试' },
        analysisResult: '功能分解完成',
        riskResult: '风险评估完成',
        reviseCount: 0,
      });

      // 验证最多修订 2 次即强制退出
      expect(result.reviseCount).toBe(2);
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('修订后需求报告');
    });

    it('getSummarySubGraphMermaid 应能正确导出 Critic-Refine 子图流程图拓扑', () => {
      const mermaid = getSummarySubGraphMermaid();
      expect(typeof mermaid).toBe('string');
      expect(mermaid).toContain('__start__ --> actor;');
      expect(mermaid).toContain('actor --> critic;');
      expect(mermaid).toContain('refine --> critic;');
      expect(mermaid).toContain('critic -.-> refine;');
    });
  });

  describe('5. 节点流式输出能力 (streamAnalysisGraph)', () => {
    it('normalizeAnalysisInput 能够正确标准化多种入参形态', () => {
      // 步骤 1：测试纯文本字符串形态
      const res1 = normalizeAnalysisInput('用户登录需求');
      expect(Array.isArray(res1.messages)).toBe(true);
      expect(res1.messages[0].content).toBe('用户登录需求');

      // 步骤 2：测试包含 messages 数组的对象形态
      const res2 = normalizeAnalysisInput({
        messages: [new HumanMessage('已有上下文')],
      });
      expect(res2.messages[0].content).toBe('已有上下文');

      // 步骤 3：测试 { input: string } 形态
      const res3 = normalizeAnalysisInput({ input: '新特性需求' });
      expect(Array.isArray(res3.messages)).toBe(true);
      expect(res3.messages[0].content).toBe('新特性需求');
    });

    it('streamAnalysisGraph 应按顺序产出 start、若干 step:update 与 done 事件', async () => {
      // 关键步骤 1：通过 mockSubAgents 注入稳定的测试打桩代理
      const events: any[] = [];
      const stream = streamAnalysisGraph(TEST_INPUT, {
        subAgents: mockSubAgents,
      });

      // 关键步骤 2：消费异步生成器产生的所有事件
      for await (const ev of stream) {
        events.push(ev);
      }

      // 关键步骤 3：断言首包为 start，尾包为 done
      expect(events.length).toBeGreaterThan(2);
      expect(events[0]).toEqual({ type: 'start' });
      expect(events[events.length - 1]).toEqual({ type: 'done' });

      // 关键步骤 4：断言中间步骤事件均具备标准结构 (type='step:update', step, patch)
      const updateEvents = events.filter((e) => e.type === 'step:update');
      expect(updateEvents.length).toBeGreaterThan(0);
      for (const update of updateEvents) {
        expect(typeof update.step).toBe('string');
        expect(typeof update.patch).toBe('object');
      }

      // 关键步骤 5：验证覆盖关键分析主图节点
      const executedSteps = updateEvents.map((e) => e.step);
      expect(executedSteps).toContain('classifier');
    });
  });
});


