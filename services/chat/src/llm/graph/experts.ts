import { ToolNode } from '@langchain/langgraph/prebuilt';
import { START, END, StateGraph } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import {
  RequirementAnalysisState,
  extractInputText,
} from './requirement-analysis-graph.js';
import {
  searchRequirementTool,
  checkConflictsTool,
} from '../tools/business.tools.js';
import {
  readFeatureSpecTool,
  loadPerfBaselineTool,
  checkPerfBudgetTool,
  checkSecurityPolicyTool,
  listAuthScenariosTool,
  checkComplianceMatrixTool,
  checkDataResidencyTool,
  checkRetentionPolicyTool,
} from '../tools/expert-tools.js';

// ============================================================
// 1. 专家子图配置契约与通用工厂
// ============================================================

export type ExpertOutputField =
  | 'functionalAnalysis'
  | 'performanceAnalysis'
  | 'securityAnalysis'
  | 'complianceAnalysis';

export interface ExpertOptions {
  name: string;
  model: BaseChatModel;
  tools: any[];
  systemPrompt: string;
  outputField: ExpertOutputField;
  maxSteps?: number;
}

/**
 * 9.2.1 专家子图工厂函数 (createExpertSubGraph)
 * 结构与 8.6 的单 Agent ReAct 子图同构，参数化了模型、工具集、系统提示词与输出状态字段
 *
 * 核心特性：
 * 1. 独立上下文：子图内部利用 messages 进行 agent ↔ tools 的 ReAct 循环
 * 2. 状态隔离：finalizeNode 仅将最终分析报告写入各自 outputField，不污染主图 messages
 * 3. 错误降级 (9.6.1)：单个专家失败时输出优雅降级说明，保证整体图流程不阻断
 * 4. 空内容兜底 (9.8.4)：模型异常返回空文本时提供占位符，防止下游 aggregator 收到空串
 */
export function createExpertSubGraph(opts: ExpertOptions) {
  const { model, tools, systemPrompt, outputField, maxSteps = 6 } = opts;

  async function agentNode(state: typeof RequirementAnalysisState.State) {
    try {
      const modelWithTools =
        typeof (model as any).bindTools === 'function'
          ? (model as any).bindTools(tools)
          : model;
      const clarifiedStr =
        typeof state.clarified === 'string'
          ? state.clarified
          : JSON.stringify(state.clarified ?? {});
      const rawInput = extractInputText(state) || (state as any).input || '';

      const response = await modelWithTools.invoke([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `已澄清的需求：${clarifiedStr}\n\n原始输入：${rawInput}`,
        },
      ]);

      // ⚠️ 子图内部的 messages 用于工具调用循环（agent → tools → agent）
      // 最终结论通过 finalizeNode 写入专家各自的 outputField，不会污染主图 messages
      return { messages: [response] };
    } catch (err) {
      // 9.6.1 节点级错误降级：返回标记失败的降级输出，而不是抛错导致整图崩溃
      return {
        [outputField]: `[${opts.name} 专家暂不可用：${err instanceof Error ? err.message : String(err)}] 本项分析已跳过，建议人工补充。`,
      };
    }
  }

  function shouldCallTools(state: typeof RequirementAnalysisState.State) {
    // 检查是否已发生降级
    const existingOutput = (state as any)[outputField];
    if (existingOutput && existingOutput.includes('暂不可用')) {
      return 'finalize';
    }

    const last = state.messages.at(-1) as any;
    const toolRounds = state.messages.filter(
      (m: any) =>
        m._getType?.() === 'tool' ||
        m.role === 'tool' ||
        (m.constructor && m.constructor.name === 'ToolMessage'),
    ).length;

    if (toolRounds >= maxSteps) {
      return 'finalize';
    }

    return last?.tool_calls && last.tool_calls.length > 0
      ? 'tools'
      : 'finalize';
  }

  async function finalizeNode(state: typeof RequirementAnalysisState.State) {
    // 9.6.1 错误降级：如果 agentNode 的 catch 已经写入"暂不可用"标记，直接保留
    const existingOutput = (state as any)[outputField];
    if (existingOutput && existingOutput.includes('暂不可用')) {
      return {};
    }

    const last = state.messages.at(-1);
    const content =
      typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last.content
              .map((c) => (typeof c === 'string' ? c : (c as any).text || ''))
              .join('')
          : '';

    // 9.8.4 Q8 空内容兜底：模型偶尔返回空 content，给个明确占位避免 aggregator 收到空串
    if (!content || !content.trim()) {
      return {
        [outputField]: `[${opts.name} 专家未生成有效输出，请检查输入和工具配置]`,
      };
    }

    // 只写入专家结论，不写入 messages
    return { [outputField]: content };
  }

  return new StateGraph(RequirementAnalysisState)
    .addNode('agent', agentNode)
    .addNode('tools', new ToolNode(tools))
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldCallTools, {
      tools: 'tools',
      finalize: 'finalize',
    })
    .addEdge('tools', 'agent')
    .addEdge('finalize', END)
    .compile();
}

// ============================================================
// 2. 四大领域专家工厂实现
// ============================================================

/**
 * 2.1 功能分析专家 (Functional Expert)
 * 职责：功能拆解、用户交互流程、功能依赖与架构冲突检测
 */
export function createFunctionalExpert(model: BaseChatModel) {
  return createExpertSubGraph({
    name: 'functional',
    model,
    tools: [searchRequirementTool, checkConflictsTool, readFeatureSpecTool],
    systemPrompt: `你是功能需求分析专家，专注评估需求的功能完整性、交互合理性和系统兼容性。

**核心职责**：
1. 功能分解：将需求拆解为具体、可实现的功能模块
2. 交互分析：评估用户操作流程的合理性和一致性
3. 冲突检测：识别与现有功能的重叠或矛盾之处

**工具使用策略**：
- 如需求提到具体编号（如 REQ-XXX），先用 search_requirement 查询详情
- 如需求涉及已有功能模块，用 read_feature_spec 获取规范
- 完成信息收集后，用 check_conflicts 检测潜在冲突

**输出必需章节（使用 Markdown 二级标题）**：
## 功能模块拆解
- 列出 3-6 个主要功能模块
- 每个模块说明核心职责和边界

## 用户交互流程
- 描述典型使用场景的完整流程
- 标注关键交互点和用户决策点

## 功能依赖关系
- 列出前置功能或模块依赖
- 说明与其他系统的集成点

## 冲突与重叠分析
- 明确指出与现有功能的冲突（如有）
- 提供解决方案或替代设计`,
    outputField: 'functionalAnalysis',
  });
}

/**
 * 2.2 性能分析专家 (Performance Expert)
 * 职责：负载评估、响应时延/吞吐量预估、瓶颈识别与性能预算校验
 */
export function createPerformanceExpert(model: BaseChatModel) {
  return createExpertSubGraph({
    name: 'performance',
    model,
    tools: [loadPerfBaselineTool, checkPerfBudgetTool],
    systemPrompt: `你是系统性能分析专家，专注评估需求对系统吞吐、延迟、资源占用的影响。

**核心职责**：
1. 负载评估：预估新需求的访问量、并发数和数据量
2. 性能影响：分析对响应时间、吞吐量、资源使用的影响
3. 瓶颈识别：找出可能的性能瓶颈和优化点

**工具使用策略**：
- 首先用 load_perf_baseline 获取相关服务的当前性能基线
- 再用 check_perf_budget 评估新需求是否超出性能预算
- 基于工具返回的数据给出量化的分析结论

**输出必需章节（使用 Markdown 二级标题）**：
## 负载特征评估
- 预估 QPS / TPS / 并发连接数
- 数据量级（单次请求、存储增长）
- 访问模式（读多写少、突发流量等）

## 性能影响分析
- 对响应时间的影响（P50/P95/P99）
- 对吞吐量的影响
- CPU、内存、磁盘、网络资源消耗
- 与当前性能基线的对比

## 性能风险与瓶颈
- 可能的性能瓶颈点（数据库、缓存、网络等）
- 容量是否充足（需要扩容吗？）
- 高并发场景下的风险

## 优化建议
- 架构层面优化（如异步处理、队列、缓存）
- 具体实施建议（限流、分片、索引等）`,
    outputField: 'performanceAnalysis',
  });
}

/**
 * 2.3 安全分析专家 (Security Expert)
 * 职责：威胁建模、攻击面分析、认证鉴权与敏感数据保护策略
 */
export function createSecurityExpert(model: BaseChatModel) {
  return createExpertSubGraph({
    name: 'security',
    model,
    tools: [checkSecurityPolicyTool, listAuthScenariosTool],
    systemPrompt: `你是信息安全分析专家，专注识别需求中的安全风险和合规要求。

**核心职责**：
1. 威胁建模：识别潜在的安全威胁（认证、授权、数据泄露等）
2. 攻击面分析：评估新功能引入的攻击向量
3. 安全策略验证：确保符合组织的安全规范

**工具使用策略**：
- 先用 check_security_policy 检查需求是否触发已知安全策略
- 如涉及身份认证或授权，用 list_auth_scenarios 了解当前认证体系
- 基于 OWASP Top 10 和行业最佳实践进行分析

**输出必需章节（使用 Markdown 二级标题）**：
## 威胁与风险识别
- 列出主要安全威胁（如 SQL 注入、XSS、CSRF、越权访问）
- 评估风险等级（高/中/低）和潜在影响

## 认证与授权
- 需求涉及的认证场景
- 权限控制要求（RBAC / ABAC）
- Session 或 Token 管理策略

## 数据保护
- 敏感数据识别（PII、凭证、密钥等）
- 传输加密要求（HTTPS、TLS版本）
- 存储加密要求（字段级加密、全盘加密）
- 数据脱敏和访问日志

## 安全实施要求
- 必须遵循的安全编码规范
- 需要的安全测试（渗透测试、SAST/DAST）
- 上线前安全检查清单`,
    outputField: 'securityAnalysis',
  });
}

/**
 * 2.4 合规分析专家 (Compliance Expert)
 * 职责：法律法规适用性、个人信息合规、数据驻留与生命周期管理
 */
export function createComplianceExpert(model: BaseChatModel) {
  return createExpertSubGraph({
    name: 'compliance',
    model,
    tools: [
      checkComplianceMatrixTool,
      checkDataResidencyTool,
      checkRetentionPolicyTool,
    ],
    systemPrompt: `你是数据合规与隐私保护专家，专注评估需求的法律合规性和监管风险。

**核心职责**：
1. 法律法规适用性：识别需求涉及的法律法规（如个人信息保护法、网络安全法）
2. 数据合规：评估数据收集、处理、存储、跨境传输的合规性
3. 行业监管：检查是否符合特定行业的监管要求（金融、医疗、教育等）

**工具使用策略**：
- 用 check_compliance_matrix 检查需求涉及的数据类型和行业要求
- 如涉及跨境数据或特定地区用户，用 check_data_residency 验证数据驻留策略
- 用 check_retention_policy 确认数据保留时长是否合规

**输出必需章节（使用 Markdown 二级标题）**：
## 适用法律法规
- 列出适用的法律法规（中国：个人信息保护法、网络安全法；欧盟：GDPR等）
- 说明触发这些法规的具体条款

## 个人信息处理合规
- 收集的个人信息类型和范围
- 收集依据（用户同意、合同履行、法定义务等）
- 告知义务（隐私政策更新点）
- 用户权利（查询、更正、删除、撤回同意）

## 数据跨境与驻留
- 数据存储位置要求
- 是否涉及跨境传输（需要的评估和审批）
- 数据本地化要求

## 数据生命周期管理
- 数据保留期限
- 删除或匿名化策略
- 备份和归档要求

## 合规风险与整改建议
- 识别的合规风险点（高/中/低）
- 需要的合规整改措施
- 建议咨询法务部门确认的事项`,
    outputField: 'complianceAnalysis',
  });
}

// ============================================================
// 3. Supervisor 调度员节点实现 (9.2.2)
// ============================================================

export const SupervisorDecisionSchema = z.object({
  experts: z
    .array(z.enum(['functional', 'performance', 'security', 'compliance']))
    .min(1)
    .max(4)
    .describe(
      '需要参与本次分析的专家列表。functional=功能分析, performance=性能分析, security=安全分析, compliance=合规分析',
    ),
  reason: z.string().describe('选择这些专家的理由'),
});

export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;

/**
 * 需求分析 Supervisor 节点
 * 使用 model.withStructuredOutput 进行结构化专家决策
 */
export async function supervisorNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
) {
  const { model } = config;
  const clarifiedStr =
    typeof state.clarified === 'string'
      ? state.clarified
      : JSON.stringify(state.clarified ?? {});
  const rawInput = extractInputText(state) || (state as any).input || '';

  try {
    const structured = (model as any).withStructuredOutput(
      SupervisorDecisionSchema,
    );
    const result = (await structured.invoke([
      {
        role: 'system',
        content: `你是需求分析调度员。根据已澄清的需求，判断本次需要哪些专家评审。

可选专家：
- functional：功能需求分析（任何需求都至少需要）
- performance：性能分析（涉及批量操作、大文件、实时性、高并发时选择）
- security：安全分析（涉及登录、权限、数据访问、文件上传时选择）
- compliance：合规分析（涉及跨境、个人信息、行业监管、金融/医疗时选择）

判断规则：
- 涉及批量操作、大文件、实时性 → 必须包含 performance
- 涉及登录、权限、数据访问 → 必须包含 security
- 涉及跨境、个人信息、行业监管 → 必须包含 compliance
- 任何需求都至少包含 functional

至少选一个专家。`,
      },
      {
        role: 'user',
        content: `已澄清的需求信息：${clarifiedStr}\n\n原始输入：${rawInput}`,
      },
    ])) as SupervisorDecision;

    const chosen =
      result?.experts && result.experts.length > 0
        ? result.experts
        : ['functional'];

    return { activeExperts: chosen };
  } catch (err) {
    // 降级兜底：调度模型异常时默认激活功能分析专家，防止子图路由中断
    return {
      activeExperts: ['functional'],
    };
  }
}

// ============================================================
// 4. Supervisor 子图装配 (createAnalysisSupervisorSubGraph, 9.2.3)
// ============================================================

/**
 * 构建并编译 Supervisor + 4 专家并行子图 (createAnalysisSupervisorSubGraph)
 *
 * 拓扑结构：
 * - START → supervisor
 * - supervisor -(routeToExperts 并行分发)-> [functional, performance, security, compliance]
 * - 所有激活的专家节点汇聚至 aggregator
 * - aggregator → END
 *
 * @param model 外部透传的模型实例，严禁在内部隐式构造
 */
export function createAnalysisSupervisorSubGraph(model: BaseChatModel) {
  // aggregator：把选中的专家结论合成 analysis / analysisResult 总输出
  async function aggregatorNode(state: typeof RequirementAnalysisState.State) {
    const parts: string[] = [];
    const active = state.activeExperts ?? [];

    if (active.includes('functional') && state.functionalAnalysis) {
      const isFallback = state.functionalAnalysis.includes('暂不可用');
      parts.push(
        `## 功能分析${isFallback ? '（降级）' : ''}\n${state.functionalAnalysis}`,
      );
    }
    if (active.includes('performance') && state.performanceAnalysis) {
      const isFallback = state.performanceAnalysis.includes('暂不可用');
      parts.push(
        `## 性能分析${isFallback ? '（降级）' : ''}\n${state.performanceAnalysis}`,
      );
    }
    if (active.includes('security') && state.securityAnalysis) {
      const isFallback = state.securityAnalysis.includes('暂不可用');
      parts.push(
        `## 安全分析${isFallback ? '（降级）' : ''}\n${state.securityAnalysis}`,
      );
    }
    if (active.includes('compliance') && state.complianceAnalysis) {
      const isFallback = state.complianceAnalysis.includes('暂不可用');
      parts.push(
        `## 合规分析${isFallback ? '（降级）' : ''}\n${state.complianceAnalysis}`,
      );
    }

    const combined = parts.join('\n\n');
    return {
      analysis: combined,
      analysisResult: combined,
      steps: ['aggregator'],
    };
  }

  // Supervisor 跑完后，按 activeExperts 动态决定走哪些分支
  function routeToExperts(state: typeof RequirementAnalysisState.State) {
    const active =
      state.activeExperts && state.activeExperts.length > 0
        ? state.activeExperts
        : ['functional'];
    // 返回一个数组 → LangGraph 会原生并发触发这些专家节点
    return active.map((e) => `${e}_expert`);
  }

  // 创建四大专家子图实例
  const functionalExpert = createFunctionalExpert(model);
  const performanceExpert = createPerformanceExpert(model);
  const securityExpert = createSecurityExpert(model);
  const complianceExpert = createComplianceExpert(model);

  return (
    new StateGraph(RequirementAnalysisState)
      .addNode('supervisor', (state) => supervisorNode(state, { model }))
      .addNode('functional_expert', functionalExpert)
      .addNode('performance_expert', performanceExpert)
      .addNode('security_expert', securityExpert)
      .addNode('compliance_expert', complianceExpert)
      .addNode('aggregator', aggregatorNode)
      .addEdge(START, 'supervisor')
      .addConditionalEdges('supervisor', routeToExperts, {
        functional_expert: 'functional_expert',
        performance_expert: 'performance_expert',
        security_expert: 'security_expert',
        compliance_expert: 'compliance_expert',
      })
      // 每个专家跑完都汇合到 aggregator（LangGraph 运行时自动等所有并发分支都到齐）
      .addEdge('functional_expert', 'aggregator')
      .addEdge('performance_expert', 'aggregator')
      .addEdge('security_expert', 'aggregator')
      .addEdge('compliance_expert', 'aggregator')
      .addEdge('aggregator', END)
      .compile()
  );
}
