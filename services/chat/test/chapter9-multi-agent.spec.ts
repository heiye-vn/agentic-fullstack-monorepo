import { describe, it, expect, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createExpertSubGraph,
  createFunctionalExpert,
  createPerformanceExpert,
  createSecurityExpert,
  createComplianceExpert,
  supervisorNode,
  createAnalysisSupervisorSubGraph,
  SupervisorDecisionSchema,
} from '../src/llm/graph/experts.js';
import {
  createAnalysisGraph,
  RequirementAnalysisState,
  triageSchema,
  triageNode,
  formatThreadId,
  hitlCheckpointer,
  createAnalysisGraphHITL,
  startAnalysisGraphHITL,
  resumeAnalysisGraphHITL,
  shouldRefine,
} from '../src/llm/graph/requirement-analysis-graph.js';
import {
  PipelineState,
  plannerNode,
  executorNode,
  evaluatorNode,
  reflectorNode,
  shouldContinue,
  shouldReflect,
  createPipelineGraph,
} from '../src/llm/graph/pipeline.js';
import { OrchestratorService } from '../src/llm/agents/orchestrator.service.js';

describe('第九章 9.2 节：Supervisor + 多专家架构测试', () => {
  // 辅助构造 Mock ChatModel
  function createMockModel(
    responseContent: string,
    structuredData?: any,
  ): BaseChatModel {
    return {
      invoke: vi.fn().mockResolvedValue(new AIMessage(responseContent)),
      bindTools: vi.fn().mockReturnThis(),
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(
          structuredData ?? {
            experts: ['functional', 'performance'],
            reason: '测试性能与功能分析',
          },
        ),
      }),
    } as unknown as BaseChatModel;
  }

  describe('9.2.1 createExpertSubGraph 通用专家子图工厂', () => {
    it('应正常执行并将结论写入指定的 outputField，不污染外部 messages', async () => {
      const mockModel = createMockModel(
        '## 功能模块拆解\n- 用户认证模块\n- 权限拦截中心',
      );
      const expertSubGraph = createExpertSubGraph({
        name: 'functional',
        model: mockModel,
        tools: [],
        systemPrompt: '你是功能需求分析专家',
        outputField: 'functionalAnalysis',
      });

      const result = await expertSubGraph.invoke({
        clarified: { requirementId: 'REQ-001', title: '登录功能' },
        input: '需要一个企业级登录认证功能',
        messages: [],
      });

      expect(result.functionalAnalysis).toContain('## 功能模块拆解');
      expect(result.functionalAnalysis).toContain('用户认证模块');
    });

    it('9.6.1 节点级错误降级：当模型抛错时应安全降级，不中断子图执行', async () => {
      const failingModel = {
        invoke: vi.fn().mockRejectedValue(new Error('Network timeout')),
        bindTools: vi.fn().mockReturnThis(),
      } as unknown as BaseChatModel;

      const expertSubGraph = createExpertSubGraph({
        name: 'security',
        model: failingModel,
        tools: [],
        systemPrompt: '你是安全专家',
        outputField: 'securityAnalysis',
      });

      const result = await expertSubGraph.invoke({
        clarified: {},
        input: '测试异常场景',
        messages: [],
      });

      expect(result.securityAnalysis).toBeDefined();
      expect(result.securityAnalysis).toContain(
        'security 专家暂不可用：Network timeout',
      );
      expect(result.securityAnalysis).toContain('建议人工补充');
    });

    it('9.8.4 空内容兜底：当模型返回空文本时应填充明确占位符', async () => {
      const emptyModel = createMockModel('');
      const expertSubGraph = createExpertSubGraph({
        name: 'compliance',
        model: emptyModel,
        tools: [],
        systemPrompt: '你是合规专家',
        outputField: 'complianceAnalysis',
      });

      const result = await expertSubGraph.invoke({
        clarified: {},
        input: '测试空输出',
        messages: [],
      });

      expect(result.complianceAnalysis).toContain(
        'compliance 专家未生成有效输出',
      );
    });
  });

  describe('9.2.1 四大领域专家工厂初始化', () => {
    it('应能成功为各个领域专家创建包含专用工具集的子图', () => {
      const mockModel = createMockModel('测试输出');

      const fnExpert = createFunctionalExpert(mockModel);
      const perfExpert = createPerformanceExpert(mockModel);
      const secExpert = createSecurityExpert(mockModel);
      const compExpert = createComplianceExpert(mockModel);

      expect(fnExpert).toBeDefined();
      expect(perfExpert).toBeDefined();
      expect(secExpert).toBeDefined();
      expect(compExpert).toBeDefined();
    });
  });

  describe('9.2.2 supervisorNode 调度员节点', () => {
    it('应使用 withStructuredOutput 正确返回激活的专家清单', async () => {
      const mockModel = createMockModel('', {
        experts: ['functional', 'performance', 'security'],
        reason: '批量导入大文件并涉及鉴权',
      });

      const state = {
        clarified: { summary: '批量导入百万行数据' },
        input: '支持批量导入并需要管理员权限',
      } as unknown as typeof RequirementAnalysisState.State;

      const result = await supervisorNode(state, { model: mockModel });
      expect(result.activeExperts).toEqual([
        'functional',
        'performance',
        'security',
      ]);
    });

    it('发生异常时应降级至默认功能分析专家', async () => {
      const failingModel = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi
            .fn()
            .mockRejectedValue(new Error('Structured output failed')),
        }),
      } as unknown as BaseChatModel;

      const state = {
        clarified: {},
        input: '异常输入测试',
      } as unknown as typeof RequirementAnalysisState.State;

      const result = await supervisorNode(state, { model: failingModel });
      expect(result.activeExperts).toEqual(['functional']);
    });
  });

  describe('9.2.3 createAnalysisSupervisorSubGraph 汇总与动态并行', () => {
    it('aggregator 应只合并被 supervisor 选中的专家结论', async () => {
      // 模拟 Supervisor 仅选中 functional 与 performance
      const mockModel = {
        invoke: vi.fn().mockImplementation(async (messages: any[]) => {
          const sys = messages.find((m) => m.role === 'system')?.content || '';
          if (sys.includes('功能需求分析')) {
            return new AIMessage('功能分析报告：拆解为导入模块与预览模块。');
          }
          if (sys.includes('系统性能分析')) {
            return new AIMessage(
              '性能分析报告：预估 2000 QPS，需引入消息队列。',
            );
          }
          return new AIMessage('通用输出');
        }),
        bindTools: vi.fn().mockReturnThis(),
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi.fn().mockResolvedValue({
            experts: ['functional', 'performance'],
            reason: '批量导入需求',
          }),
        }),
      } as unknown as BaseChatModel;

      const supervisorSubGraph = createAnalysisSupervisorSubGraph(mockModel);
      const result = await supervisorSubGraph.invoke({
        clarified: { title: '批量导入 Excel' },
        input: '支持批量导入 Excel 用户数据，单次最多 10000 行',
        messages: [],
      });

      expect(result.activeExperts).toEqual(['functional', 'performance']);
      expect(result.analysisResult).toContain('## 功能分析');
      expect(result.analysisResult).toContain(
        '功能分析报告：拆解为导入模块与预览模块。',
      );
      expect(result.analysisResult).toContain('## 性能分析');
      expect(result.analysisResult).toContain(
        '性能分析报告：预估 2000 QPS，需引入消息队列。',
      );
      // 未被选中的专家不应出现在汇总报告中
      expect(result.analysisResult).not.toContain('## 安全分析');
      expect(result.analysisResult).not.toContain('## 合规分析');
    });

    it('aggregator 应正确呈现降级标记（⚠️ 降级）', async () => {
      // functional 抛错降级，performance 正常
      const mockModel = {
        invoke: vi.fn().mockImplementation(async (messages: any[]) => {
          const sys = messages.find((m) => m.role === 'system')?.content || '';
          if (sys.includes('功能需求分析')) {
            throw new Error('功能接口超时');
          }
          if (sys.includes('系统性能分析')) {
            return new AIMessage('性能基线达标。');
          }
          return new AIMessage('默认输出');
        }),
        bindTools: vi.fn().mockReturnThis(),
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi.fn().mockResolvedValue({
            experts: ['functional', 'performance'],
            reason: '测试降级展示',
          }),
        }),
      } as unknown as BaseChatModel;

      const supervisorSubGraph = createAnalysisSupervisorSubGraph(mockModel);
      const result = await supervisorSubGraph.invoke({
        clarified: {},
        input: '测试部分专家故障',
        messages: [],
      });

      expect(result.analysisResult).toContain('## 功能分析（降级）');
      expect(result.analysisResult).toContain(
        'functional 专家暂不可用：功能接口超时',
      );
      expect(result.analysisResult).toContain('## 性能分析');
      expect(result.analysisResult).toContain('性能基线达标。');
    });
  });

  describe('9.2.4 主图支持切换多专家子图', () => {
    it('当传入 useMultiAgent: true 与 model 时，主图能无缝装配并执行', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue(new AIMessage('综合评审总结完成。')),
        bindTools: vi.fn().mockReturnThis(),
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi.fn().mockResolvedValue({
            intent: 'analyze',
            reasoning: '业务需求分析',
            experts: ['functional'],
            reason: '通用需求',
            pass: true,
            critique: '',
          }),
        }),
      } as unknown as BaseChatModel;

      const mainGraph = createAnalysisGraph({
        useMultiAgent: true,
        model: mockModel,
      });

      expect(mainGraph).toBeDefined();
    });
  });

  describe('9.4 Handoff 模式与 Triage 分诊节点测试', () => {
    describe('9.4.1 triageSchema 校验', () => {
      it('接受 3 种合法的 action: answer, handoff_to_analysis, handoff_to_query', () => {
        const answer = triageSchema.parse({
          action: 'answer',
          response: '你好！我是需求分诊智能体。',
          reason: null,
        });
        expect(answer.action).toBe('answer');
        expect(answer.response).toBe('你好！我是需求分诊智能体。');

        const analysis = triageSchema.parse({
          action: 'handoff_to_analysis',
          response: '',
          reason: '需要多维度专家深入拆解与评估',
        });
        expect(analysis.action).toBe('handoff_to_analysis');
        expect(analysis.reason).toBe('需要多维度专家深入拆解与评估');

        const query = triageSchema.parse({
          action: 'handoff_to_query',
          response: '',
          reason: '查询已有需求单状态与属性',
        });
        expect(query.action).toBe('handoff_to_query');
        expect(query.reason).toBe('查询已有需求单状态与属性');
      });

      it('拒绝旧 handoff_to_risk（已删除）与非法 action 类型', () => {
        expect(() => {
          triageSchema.parse({ action: 'handoff_to_risk', response: '' });
        }).toThrow();

        expect(() => {
          triageSchema.parse({ action: 'invalid_action', response: '' });
        }).toThrow();
      });
    });

    describe('9.4.2 triageNode 逻辑与 Intent 映射', () => {
      it('当 action 为 answer 时，返回 chat 意图与包含回复的 AIMessage，并记录 handoffReason', async () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              action: 'answer',
              response: '您好！今天有什么可以帮您的？',
              reason: '日常问候',
            }),
          }),
        } as unknown as BaseChatModel;

        const result = await triageNode(
          {
            messages: [],
            input: '你好呀',
          } as any,
          { model: mockModel },
        );

        expect(result.intent).toBe('chat');
        expect(result.chatResponse).toBe('您好！今天有什么可以帮您的？');
        expect(result.handoffReason).toBe('日常问候');
        expect(result.messages).toHaveLength(1);
        expect(result.messages![0]).toBeInstanceOf(AIMessage);
        expect(result.messages![0].content).toBe('您好！今天有什么可以帮您的？');
      });

      it('当 action 为 handoff_to_analysis 时，返回 analyze 意图并附带交接 AIMessage 与理由', async () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              action: 'handoff_to_analysis',
              response: '',
              reason: '用户需要开发高并发优惠券秒杀系统',
            }),
          }),
        } as unknown as BaseChatModel;

        const result = await triageNode(
          {
            messages: [],
            input: '需要开发优惠券秒杀功能，支持 10 万人同时抢券',
          } as any,
          { model: mockModel },
        );

        expect(result.intent).toBe('analyze');
        expect(result.handoffReason).toBe('用户需要开发高并发优惠券秒杀系统');
        expect(result.messages).toHaveLength(1);
        expect(result.messages![0]).toBeInstanceOf(AIMessage);
        expect(result.messages![0].content).toContain('[分诊交接 → 需求分析]');
        expect(result.messages![0].content).toContain(
          '用户需要开发高并发优惠券秒杀系统',
        );
      });

      it('当 action 为 handoff_to_query 时，返回 query 意图与交接理由', async () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              action: 'handoff_to_query',
              response: '',
              reason: '查询已有需求 REQ-20240315-001 状态',
            }),
          }),
        } as unknown as BaseChatModel;

        const result = await triageNode(
          {
            messages: [],
            input: '查一下 REQ-20240315-001 进度',
          } as any,
          { model: mockModel },
        );

        expect(result.intent).toBe('query');
        expect(result.handoffReason).toBe('查询已有需求 REQ-20240315-001 状态');
      });

      it('当模型调用异常时，能优雅降级（日常闲聊降级为 chat，业务输入降级为 analyze）', async () => {
        const mockErrorModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockRejectedValue(new Error('LLM 接口超时')),
          }),
        } as unknown as BaseChatModel;

        // 闲聊降级测试
        const chatFallback = await triageNode(
          {
            messages: [],
            input: '你好，早上好',
          } as any,
          { model: mockErrorModel },
        );
        expect(chatFallback.intent).toBe('chat');
        expect(chatFallback.handoffReason).toContain('降级兜底');

        // 业务需求降级测试
        const analysisFallback = await triageNode(
          {
            messages: [],
            input: '设计一个在线支付退款流程',
          } as any,
          { model: mockErrorModel },
        );
        expect(analysisFallback.intent).toBe('analyze');
        expect(analysisFallback.handoffReason).toContain('降级兜底');
      });
    });

    describe('9.4.3 主图集成验证 (useTriage)', () => {
      it('主图开启 useTriage: true 能成功编译并处理闲聊短路', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue(new AIMessage('兜底总结')),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              action: 'answer',
              response: '您好！我是智能助理。',
              reason: '问候直答',
            }),
          }),
        } as unknown as BaseChatModel;

        const triageGraph = createAnalysisGraph({
          useTriage: true,
          model: mockModel,
        });

        expect(triageGraph).toBeDefined();

        // 模拟执行闲聊输入
        const result = await triageGraph.invoke({
          input: '你好',
          messages: [],
        });

        // 闲聊直接由 triage 答复并短路到 END，不进入 extractStep 等后续节点
        expect(result.intent).toBe('chat');
        expect(result.chatResponse).toBe('您好！我是智能助理。');
        expect(result.handoffReason).toBe('问候直答');
      });
    });
  });

  describe('9.5 Plan-and-Execute 外层流水线 + Reflexion 测试', () => {
    it('PipelineState 契约正确定义', () => {
      expect(PipelineState).toBeDefined();
    });

    describe('9.5.1 plannerNode 规划能力', () => {
      it('能将大任务拆解为步骤列表，并初始化 currentStepIndex 和 parentThreadId', async () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              steps: [
                { id: 'step-1', description: '分析 REQ-001 登录模块' },
                { id: 'step-2', description: '分析 REQ-002 权限控制' },
                { id: 'step-3', description: '评估两者的交叉影响与安全边界' },
              ],
              reasoning: '先单需求再交叉分析',
            }),
          }),
        } as unknown as BaseChatModel;

        const result = await plannerNode(
          {
            messages: [new HumanMessage('评估用户中心改造相关需求')],
            plan: [],
            currentStepIndex: 0,
            stepResults: {},
            reflections: [],
            retryCount: 0,
            parentThreadId: '',
            finalReport: '',
            approved: false,
          },
          { model: mockModel },
        );

        expect(result.plan).toHaveLength(3);
        expect(result.plan![0]).toEqual({
          id: 'step-1',
          description: '分析 REQ-001 登录模块',
          done: false,
        });
        expect(result.currentStepIndex).toBe(0);
        expect(result.parentThreadId).toMatch(/^pipeline-\d+/);
      });
    });

    describe('9.5.2 executorNode 步骤推进与容灾', () => {
      it('执行当前步骤，标记完成，推进 currentStepIndex 并写入 stepResults', async () => {
        const mockAnalysisGraph = {
          invoke: vi.fn().mockResolvedValue({
            summary: 'REQ-001 模块分析完毕，无高风险。',
          }),
        };

        const state: any = {
          plan: [
            { id: 'step-1', description: '分析 REQ-001', done: false },
            { id: 'step-2', description: '分析 REQ-002', done: false },
          ],
          currentStepIndex: 0,
          parentThreadId: 'parent-123',
          stepResults: {},
        };

        const result = await executorNode(state, {
          analysisGraph: mockAnalysisGraph,
        });

        expect(mockAnalysisGraph.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [expect.any(HumanMessage)],
          }),
          expect.objectContaining({
            configurable: { thread_id: 'parent-123:step-0' },
          }),
        );
        expect(result.currentStepIndex).toBe(1);
        expect(result.plan![0].done).toBe(true);
        expect(result.stepResults!['step-1']).toBe(
          'REQ-001 模块分析完毕，无高风险。',
        );
      });

      it('超出步骤范围时安全返回空对象', async () => {
        const state: any = {
          plan: [{ id: 'step-1', description: '已完成步骤', done: true }],
          currentStepIndex: 1,
          stepResults: {},
        };

        const result = await executorNode(state);
        expect(result).toEqual({});
      });

      it('单步子图抛错时降级记录失败原因，不中断流程', async () => {
        const mockAnalysisGraph = {
          invoke: vi.fn().mockRejectedValue(new Error('数据库连接失败')),
        };

        const state: any = {
          plan: [{ id: 'step-1', description: '分析 REQ-001', done: false }],
          currentStepIndex: 0,
          parentThreadId: 'parent-123',
          stepResults: {},
        };

        const result = await executorNode(state, {
          analysisGraph: mockAnalysisGraph,
        });

        expect(result.currentStepIndex).toBe(1);
        expect(result.plan![0].done).toBe(true);
        expect(result.stepResults!['step-1']).toContain('[执行失败]');
        expect(result.stepResults!['step-1']).toContain('数据库连接失败');
      });
    });

    describe('9.5.3 evaluatorNode 质量评估与 reflectorNode 反思重跑', () => {
      it('evaluatorNode 正确汇总各步骤结果并打分', async () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              approved: true,
              score: 90,
              issues: [],
              suggestion: '报告整体严谨可落地',
            }),
          }),
        } as unknown as BaseChatModel;

        const state: any = {
          plan: [
            { id: 'step-1', description: '分析 REQ-001', done: true },
            { id: 'step-2', description: '分析 REQ-002', done: true },
          ],
          stepResults: {
            'step-1': 'REQ-001 分析结论',
            'step-2': 'REQ-002 分析结论',
          },
        };

        const result = await evaluatorNode(state, { model: mockModel });

        expect(result.approved).toBe(true);
        expect(result.finalReport).toContain('### 步骤1:分析 REQ-001');
        expect(result.finalReport).toContain('### 步骤2:分析 REQ-002');
      });

      it('reflectorNode 面对不合格报告修订计划，重置 currentStepIndex 为 0 并增加 retryCount', async () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              revisedSteps: [
                { id: 'step-1', description: '重新细化 REQ-001 接口定义' },
                { id: 'step-2', description: '补充权限穿透安全性审查' },
              ],
              reflection: '上一轮缺少接口详细契约与安全漏洞防护方案',
            }),
          }),
        } as unknown as BaseChatModel;

        const state: any = {
          finalReport: '# 上一轮报告（缺少安全分析）',
          plan: [{ id: 'step-1', description: '初步分析', done: true }],
          retryCount: 0,
        };

        const result = await reflectorNode(state, { model: mockModel });

        expect(result.currentStepIndex).toBe(0); // 重头开始
        expect(result.retryCount).toBe(1); // 增加重试计数
        expect(result.plan).toHaveLength(2);
        expect(result.reflections).toEqual([
          '上一轮缺少接口详细契约与安全漏洞防护方案',
        ]);
      });
    });

    describe('9.5.4 路由逻辑与外层流水线图装配', () => {
      it('shouldContinue 路由判断准确', () => {
        expect(
          shouldContinue({
            plan: [{ id: 's1', description: '', done: false }],
            currentStepIndex: 0,
          } as any),
        ).toBe('executor');

        expect(
          shouldContinue({
            plan: [{ id: 's1', description: '', done: true }],
            currentStepIndex: 1,
          } as any),
        ).toBe('evaluator');
      });

      it('shouldReflect 条件分支判断准确（含 retryCount >= 1 硬上限）', () => {
        // 评估通过 -> END
        expect(shouldReflect({ approved: true, retryCount: 0 } as any)).toBe(
          '__end__',
        );

        // 评估未通过且未达重试上限 -> reflector
        expect(shouldReflect({ approved: false, retryCount: 0 } as any)).toBe(
          'reflector',
        );

        // 评估未通过但已重试 1 次（硬上限熔断）-> END
        expect(shouldReflect({ approved: false, retryCount: 1 } as any)).toBe(
          '__end__',
        );
      });

      it('createPipelineGraph 外层图成功构建与编译', () => {
        const mockModel = {
          invoke: vi.fn(),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn(),
          }),
        } as unknown as BaseChatModel;

        const graph = createPipelineGraph(mockModel);
        expect(graph).toBeDefined();
      });
    });
  });

  describe('第九章 9.6 节：Multi-Agent 系统的生产化工程能力测试', () => {
    describe('9.6.1 错误降级与容灾机制', () => {
      it('单专家抛错时返回降级文本而不中断子图流转', async () => {
        const failingModel = {
          invoke: vi.fn().mockRejectedValue(new Error('专家服务超时或不可用')),
          bindTools: vi.fn().mockReturnThis(),
        } as unknown as BaseChatModel;

        const subGraph = createExpertSubGraph({
          name: 'compliance',
          model: failingModel,
          tools: [],
          systemPrompt: '合规专家',
          outputField: 'complianceAnalysis',
        });

        const res = await subGraph.invoke({
          input: '合规检查需求',
          clarified: {},
          messages: [],
        });

        expect(res.complianceAnalysis).toBeDefined();
        expect(res.complianceAnalysis).toContain(
          '[compliance 专家暂不可用：专家服务超时或不可用] 本项分析已跳过，建议人工补充。',
        );
      });

      it('aggregatorNode 能够识别降级标记并在报告标题中标识（降级）', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue(new AIMessage('功能分析正常完成')),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              experts: ['functional', 'security'],
              reason: '需要功能与安全分析',
            }),
          }),
        } as unknown as BaseChatModel;

        const supervisorSubGraph = createAnalysisSupervisorSubGraph(mockModel);
        const res = await supervisorSubGraph.invoke({
          input: '测试系统',
          activeExperts: ['functional', 'security'],
          functionalAnalysis: '功能分析正常完成',
          securityAnalysis:
            '[security 专家暂不可用：Connection reset] 本项分析已跳过，建议人工补充。',
          messages: [],
        });

        expect(res.analysisResult).toContain('## 功能分析\n功能分析正常完成');
        expect(res.analysisResult).toContain('## 安全分析（降级）');
        expect(res.analysisResult).toContain('建议人工补充');
      });
    });

    describe('9.6.2 Checkpointer 与 HITL 状态恢复', () => {
      it('formatThreadId 遵循 user-{userId}:session-{sessionId} 命名规范', () => {
        const threadId = formatThreadId('u-1001', 's-999');
        expect(threadId).toBe('user-u-1001:session-s-999');
      });

      it('startAnalysisGraphHITL 能在 clarifyStep 前暂停并保存 snapshot 快照', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue(new AIMessage('分析结果')),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              action: 'handoff_to_analysis',
              reason: '进入完整分析',
              experts: ['functional'],
            }),
          }),
        } as unknown as BaseChatModel;

        const mockSubAgents: any = {
          extractAgent: {
            invoke: vi.fn().mockResolvedValue(
              JSON.stringify({
                action: '创建订单中心',
                coreFeature: '分布式事务支持',
              }),
            ),
          },
          clarifyAgent: {
            invoke: vi.fn().mockResolvedValue(
              JSON.stringify({ needsClarification: false }),
            ),
          },
          analysisAgent: { invoke: vi.fn().mockResolvedValue('分析完成') },
          riskAgent: { invoke: vi.fn().mockResolvedValue('风险可控') },
          summaryAgent: { invoke: vi.fn().mockResolvedValue('报告生成完成') },
        };

        const threadId = formatThreadId('test-user', 'session-hitl-1');
        const snapshot = await startAnalysisGraphHITL(
          threadId,
          '需要建设支持分布式事务的订单中心',
          {
            model: mockModel,
            subAgents: mockSubAgents,
            useMultiAgent: false,
            useTriage: true,
          },
        );

        // 验证已暂停在 clarifyStep 之前
        expect(snapshot).toBeDefined();
        expect(snapshot.next).toEqual(['clarifyStep']);
        // 验证抽取结果已写入快照
        expect(snapshot.values.extracted).toEqual(
          expect.objectContaining({
            action: '创建订单中心',
            coreFeature: '分布式事务支持',
          }),
        );
      });

      it('resumeAnalysisGraphHITL 能注入人工澄清补丁并从断点继续执行至完成', async () => {
        const mockModel = {
          invoke: vi
            .fn()
            .mockResolvedValue(new AIMessage('最终多租户设计文档')),
          bindTools: vi.fn().mockReturnThis(),
          withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({
              action: 'handoff_to_analysis',
              reason: '进入分析',
              experts: ['functional'],
            }),
          }),
        } as unknown as BaseChatModel;

        const mockSubAgents: any = {
          extractAgent: {
            invoke: vi.fn().mockResolvedValue(
              JSON.stringify({
                action: '支持多租户隔离',
                coreFeature: '数据行级权限控制',
              }),
            ),
          },
          clarifyAgent: {
            invoke: vi.fn().mockResolvedValue(
              JSON.stringify({ needsClarification: false }),
            ),
          },
          analysisAgent: { invoke: vi.fn().mockResolvedValue('多租户架构分析') },
          riskAgent: { invoke: vi.fn().mockResolvedValue('数据越权风险极小') },
          summaryAgent: { invoke: vi.fn().mockResolvedValue('最终多租户设计文档') },
        };

        const threadId = formatThreadId('test-user', 'session-hitl-2');
        // 先启动至 clarifyStep 暂停
        await startAnalysisGraphHITL(
          threadId,
          '需要实现多租户隔离',
          {
            model: mockModel,
            subAgents: mockSubAgents,
            useMultiAgent: false,
            useTriage: true,
          },
        );

        // 人工介入：更新 clarified 补丁并从断点恢复
        const resumedResult = await resumeAnalysisGraphHITL(
          threadId,
          {
            clarified: {
              needsClarification: false,
              questions: [],
              clarificationQuestions: [],
              reason: '人工已确认无须二次澄清',
            },
          },
          {
            model: mockModel,
            subAgents: mockSubAgents,
            useMultiAgent: false,
            useTriage: true,
          },
        );

        expect(resumedResult).toBeDefined();
        expect(resumedResult.summary).toBe('最终多租户设计文档');
        expect(resumedResult.steps).toContain('clarifyStep');
        expect(resumedResult.steps).toContain('actor');
      });
    });

    describe('9.6.3 UI 协议升级 (toUIResponse)', () => {
      const orchestrator = new OrchestratorService();

      it('interrupted 时渲染 confirmation 组件（HITL）', () => {
        const interruptedState = {
          intent: 'analyze',
          extracted: { coreFeature: '大文件分片上传' },
          clarificationQuestions: ['单文件大小上限是多少？', '是否支持断点续传？'],
        };

        const uiRes = orchestrator.toUIResponse(interruptedState, {
          isInterrupted: true,
          threadId: 'user-1:session-1',
        });

        expect(uiRes).toBeDefined();
        expect(uiRes.components).toBeDefined();
        const confirmationComp = uiRes.components.find(
          (c) => c.type === 'confirmation',
        ) as any;
        expect(confirmationComp).toBeDefined();
        expect(confirmationComp.actionKey).toBe('resume_analysis');
        expect(confirmationComp.warning).toContain('单文件大小上限是多少？');
        expect(confirmationComp.details.threadId).toBe('user-1:session-1');
        expect(uiRes.context?.sessionStage).toBe('clarification_interrupted');
      });

      it('从 state.activeExperts 动态生成 steps 组件', () => {
        const state = {
          intent: 'analyze',
          extracted: { coreFeature: '高性能实时计算' },
          clarified: { needsClarification: false },
          activeExperts: ['functional', 'performance', 'security'],
          functionalAnalysis: '功能分析完成',
          performanceAnalysis: '性能分析完成',
          // securityAnalysis 尚未完成，预期 running
          riskResult: '风险低',
          summary: '总体报告',
        };

        const uiRes = orchestrator.toUIResponse(state);
        const stepsComp = uiRes.components.find(
          (c) => c.type === 'steps',
        ) as any;

        expect(stepsComp).toBeDefined();
        expect(stepsComp.items).toBeDefined();
        const items = stepsComp.items;

        // 验证专家 step 动态生成
        const funcStep = items.find((s: any) => s.label === 'functional_expert');
        const perfStep = items.find((s: any) => s.label === 'performance_expert');
        const secStep = items.find((s: any) => s.label === 'security_expert');

        expect(funcStep).toBeDefined();
        expect(funcStep.status).toBe('completed');
        expect(perfStep).toBeDefined();
        expect(perfStep.status).toBe('completed');
        expect(secStep).toBeDefined();
        expect(secStep.status).toBe('running');
      });

      it('保持向后兼容：能够正确处理旧版 OrchestrationResult', () => {
        const legacyResult: any = {
          mode: 'fixed_workflow',
          status: 'completed',
          report: '# 旧版工作流报告',
          usedAgents: ['extractAgent', 'summaryAgent'],
          steps: [
            { agent: 'extractAgent', status: 'success', durationMs: 120 },
            { agent: 'summaryAgent', status: 'success', durationMs: 350 },
          ],
        };

        const uiRes = orchestrator.toUIResponse(legacyResult);
        expect(uiRes.message).toBe('# 旧版工作流报告');
        const stepsComp = uiRes.components.find((c) => c.type === 'steps') as any;
        expect(stepsComp).toBeDefined();
        expect(stepsComp.items).toHaveLength(2);
        expect(stepsComp.items[0].label).toBe('extractAgent');
        expect(stepsComp.items[0].status).toBe('completed');
      });
    });

    describe('9.6.4 成本控制硬上限约束', () => {
      it('activeExperts 最多 4 个（Zod Schema 校验）', () => {
        // 允许 1 到 4 个
        const validDecision = {
          experts: ['functional', 'performance', 'security', 'compliance'],
          reason: '4 个专家同时分析',
        };
        expect(() =>
          SupervisorDecisionSchema.parse(validDecision),
        ).not.toThrow();

        // 超过 4 个拒绝
        const invalidDecision = {
          experts: [
            'functional',
            'performance',
            'security',
            'compliance',
            'functional', // 重复或超限第 5 个
          ],
          reason: '超过 4 个专家',
        };
        expect(() => SupervisorDecisionSchema.parse(invalidDecision)).toThrow();
      });

      it('Critic-Refine：shouldRefine 具有 reviseCount >= 2 硬上限熔断', () => {
        // reviseCount < 2 且有 critique 时继续 refine
        expect(
          shouldRefine({
            reviseCount: 1,
            critique: '需要修改格式',
          } as any),
        ).toBe('refine');

        // reviseCount >= 2 熔断到 __end__
        expect(
          shouldRefine({
            reviseCount: 2,
            critique: '依然有意见',
          } as any),
        ).toBe('__end__');
      });

      it('Reflexion：shouldReflect 具有 retryCount >= 1 硬上限熔断', () => {
        // retryCount < 1 时允许重试
        expect(
          shouldReflect({
            approved: false,
            retryCount: 0,
          } as any),
        ).toBe('reflector');

        // retryCount >= 1 熔断到 __end__
        expect(
          shouldReflect({
            approved: false,
            retryCount: 1,
          } as any),
        ).toBe('__end__');
      });
    });
  });
});
