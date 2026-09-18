import { HIGH_RISK_AGENTS } from './agent-model-set.js';

/**
 * 预算策略动作类型：
 * - allow: 允许按当前配置继续执行
 * - downgrade: 预算紧张，非高风险 Agent 降级执行
 * - reject: 预算超限，拒绝执行当前调用
 */
export type BudgetAction = 'allow' | 'downgrade' | 'reject';

/**
 * 预算策略输入接口
 */
export interface BudgetPolicyInput {
  budgetUsedPercent: number;
  agentName: string;
  requirementRiskLevel?: 'low' | 'medium' | 'high';
}

/**
 * 预算策略输出接口
 */
export interface BudgetPolicyOutput {
  action: BudgetAction;
  reason: string;
}

// 复用并重新导出高风险智能体列表（与 10.7 agent-model-set 保持一致）
export { HIGH_RISK_AGENTS };

/**
 * 运行时预算策略仲裁器（纯函数，无副作用，无 IO）
 *
 * 决策逻辑严格保序：
 * 1. budgetUsedPercent < 80：正常执行（allow），reason 附带当前百分比
 * 2. budgetUsedPercent ∈ [80, 100)：
 *    - 若 agent ∈ HIGH_RISK_AGENTS：高风险角色不降级（allow）
 *    - 否则：低风险角色允许降级（downgrade）
 * 3. budgetUsedPercent >= 100：
 *    - 若 agent === 'compressor'：对话压缩节点作为降本工具，享有特权豁免（allow）
 *    - 否则：超预算一律阻断（reject）
 */
export function resolveBudgetAction(input: BudgetPolicyInput): BudgetPolicyOutput {
  const { budgetUsedPercent, agentName } = input;

  // 1. 预算充足 (< 80%)：正常通过
  if (budgetUsedPercent < 80) {
    return {
      action: 'allow',
      reason: `budget OK (${budgetUsedPercent}%)`,
    };
  }

  // 2. 预算紧张 (80% - 100%)：依据 Agent 风险等级决策
  if (budgetUsedPercent < 100) {
    const isHighRisk = (HIGH_RISK_AGENTS as readonly string[]).includes(agentName);
    if (isHighRisk) {
      return {
        action: 'allow',
        reason: `high-risk agent, no downgrade (${budgetUsedPercent}%)`,
      };
    }
    return {
      action: 'downgrade',
      reason: `budget tight, low-risk agent can downgrade (${budgetUsedPercent}%)`,
    };
  }

  // 3. 预算超限 (>= 100%)：compressor 作为省钱工具永久豁免，其余角色全部拒绝执行
  if (agentName === 'compressor') {
    return {
      action: 'allow',
      reason: 'compressor allowed even over budget (cost reduction purpose)',
    };
  }

  return {
    action: 'reject',
    reason: `budget exceeded (${budgetUsedPercent}%)`,
  };
}
