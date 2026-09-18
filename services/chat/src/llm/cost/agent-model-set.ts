/**
 * 智能体角色枚举
 */
export type AgentName =
  | 'supervisor'
  | 'functional_expert'
  | 'performance_expert'
  | 'security_expert'
  | 'compliance_expert'
  | 'risk_agent'
  | 'summary_agent'
  | 'critic'
  | 'compressor';

/**
 * 智能体模型配置映射接口
 */
export interface AgentModelSet {
  supervisorModelConfigId: string;
  functionalModelConfigId: string;
  performanceModelConfigId: string;
  securityModelConfigId: string;
  complianceModelConfigId: string;
  riskModelConfigId: string;
  summaryModelConfigId: string;
  criticModelConfigId: string;
  compressorModelConfigId: string;
}

/**
 * 默认模型分配方案：
 * - 强推理/高风险角色（supervisor, security, compliance, summary, critic）使用旗舰模型
 * - 中等复杂度专家（functional, performance, risk）使用中档模型
 * - 摘要压缩节点（compressor）使用最低单价模型
 *
 * ⚠️ 这里的 modelConfigId 对应 `model_configs.id`，由 `scripts/setup-demo-db.ts` 播种；
 * 用「档位」而不是模型名做 ID，避免出现"ID 叫 gpt-4o、实际调 qwen3.8-max"这类
 * 名称与实体漂移 —— 那会让 token-estimator 的定价查表算错成本。
 *
 * 档位按 token 单价排序（见 token-estimator.ts 的 PRICING）：
 *   strong  qwen3.8-max        $1.667 / $5.000  per 1M
 *   medium  deepseek-v4-flash  $0.208 / $0.625
 *   weak    qwen3.7-flash      $0.028 / $0.111
 * 降级（medium/weak）必须真的更便宜，否则"预算紧张就降级"失去意义。
 */
export const DEFAULT_AGENT_MODEL_SET: AgentModelSet = {
  supervisorModelConfigId: 'demo-model-strong',
  functionalModelConfigId: 'demo-model-medium',
  performanceModelConfigId: 'demo-model-medium',
  securityModelConfigId: 'demo-model-strong',
  complianceModelConfigId: 'demo-model-strong',
  riskModelConfigId: 'demo-model-medium',
  summaryModelConfigId: 'demo-model-strong',
  criticModelConfigId: 'demo-model-strong',
  compressorModelConfigId: 'demo-model-weak',
};

/**
 * 高风险角色列表：影响全局调度或法律合规，预算紧张时不降级
 */
export const HIGH_RISK_AGENTS: AgentName[] = [
  'supervisor',
  'security_expert',
  'compliance_expert',
  'critic',
  'summary_agent',
];

/**
 * AgentName 到 AgentModelSet 字段名的映射关系
 */
export const AGENT_TO_CONFIG_KEY: Record<AgentName, keyof AgentModelSet> = {
  supervisor: 'supervisorModelConfigId',
  functional_expert: 'functionalModelConfigId',
  performance_expert: 'performanceModelConfigId',
  security_expert: 'securityModelConfigId',
  compliance_expert: 'complianceModelConfigId',
  risk_agent: 'riskModelConfigId',
  summary_agent: 'summaryModelConfigId',
  critic: 'criticModelConfigId',
  compressor: 'compressorModelConfigId',
};

/**
 * 模型选择函数入参接口
 */
export interface ResolveModelInput {
  agentName: AgentName;
  defaultModelSet?: AgentModelSet;
  requirementComplexity?: 'low' | 'medium' | 'high';
  budgetStatus?: { usedPercent: number };
}

/**
 * 模型选择函数返回结构
 */
export interface ResolveModelOutput {
  selectedModelConfigId: string;
  overrideReason: string | null;
}

/**
 * 两层模型选择决策函数：按角色默认查表 + 运行时动态覆盖（纯函数，无外部副作用）
 *
 * 决策优先级顺序（严格保序）：
 * 0. agentName 未登记在 AGENT_TO_CONFIG_KEY：回退 functional 模型，reason='unknown agent: xxx'
 * 1. budgetPercent >= 100 且 agentName === 'compressor'：返回默认 modelConfigId、reason=null（compressor 豁免）
 * 2. budgetPercent >= 100 其余 agent：返回默认 modelConfigId、reason='budget_exceeded_reject'
 * 3. budgetPercent ∈ [80, 100) 且非高风险：返回 modelSet.compressorModelConfigId、reason=`budget_tight_downgrade (${budgetPercent}%)`
 * 4. requirementComplexity === 'low' 且非高风险：返回 modelSet.compressorModelConfigId、reason='low_complexity_downgrade'
 * 5. 否则：返回默认 modelConfigId、reason=null
 */
export function resolveModelForAgent(input: ResolveModelInput): ResolveModelOutput {
  const modelSet = input.defaultModelSet || DEFAULT_AGENT_MODEL_SET;
  const configKey = AGENT_TO_CONFIG_KEY[input.agentName];
  // 运行时的 agentName 可能来自数据库字段 / 字符串参数，未必受联合类型约束：
  // 未登记的角色直接回退到功能性模型并标记原因，避免返回 undefined 变成"无模型可用"。
  if (!configKey) {
    return {
      selectedModelConfigId: modelSet.functionalModelConfigId,
      overrideReason: `unknown agent: ${input.agentName}`,
    };
  }

  const defaultId = modelSet[configKey];
  const isHighRisk = HIGH_RISK_AGENTS.includes(input.agentName);
  const budgetPercent = input.budgetStatus?.usedPercent ?? 0;

  // 1. 预算超限检查 (>= 100%)
  if (budgetPercent >= 100) {
    if (input.agentName === 'compressor') {
      return { selectedModelConfigId: defaultId, overrideReason: null }; // compressor 豁免
    }
    return { selectedModelConfigId: defaultId, overrideReason: 'budget_exceeded_reject' };
  }

  // 2. 预算紧张预警 (80% - 100%)：非高风险 Agent 降级到低成本模型
  if (budgetPercent >= 80 && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: `budget_tight_downgrade (${budgetPercent}%)`,
    };
  }

  // 3. 低复杂度需求：非高风险 Agent 降级到低成本模型
  if (input.requirementComplexity === 'low' && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: 'low_complexity_downgrade',
    };
  }

  // 4. 默认基线：按角色查表返回默认模型
  return { selectedModelConfigId: defaultId, overrideReason: null };
}
