/**
 * Token 估算器与模型定价表
 *
 * 关键约束：
 * - 估算器只用于设计期"这条链路大概多少钱"，不负责精确成本——精确值由 10.8 的 withTokenUsage 从 provider usage 读取
 * - 百炼模型价格由后台人民币价格换算自 1 USD ≈ 7.2 RMB，仅供参考；上线前请以官网为准
 * - 中文 token 估算偏简化（1 字 ≈ 1 token），保持零外部依赖（无需引入 tiktoken）
 */

export interface ModelPricing {
  input: number;
  output: number;
  cachedInput?: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // 阿里云百炼平台 5 个模型（折算为 USD/1M tokens，汇率按 1 USD ≈ 7.2 RMB 换算）
  'qwen3.7-flash-2026-07-15': { input: 0.028, output: 0.111, cachedInput: 0.006 },
  'qwen3.7-flash': { input: 0.028, output: 0.111, cachedInput: 0.006 },

  'deepseek-v4-flash-0731': { input: 0.208, output: 0.625, cachedInput: 0.021 },
  'deepseek-v4-flash': { input: 0.208, output: 0.625, cachedInput: 0.021 },

  'glm-5.3': { input: 1.111, output: 3.889, cachedInput: 0.278 },

  'qwen3.8-max': { input: 1.667, output: 5.000, cachedInput: 0.208 },

  'kimi-k3': { input: 2.778, output: 13.889, cachedInput: 0.278 },

  // 教程原有基准模型（避免测试报错）
  'gpt-4o': { input: 2.50, output: 10.00, cachedInput: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cachedInput: 0.075 },
  'claude-sonnet': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'claude-haiku': { input: 0.80, output: 4.00, cachedInput: 0.08 },
  'deepseek-chat': { input: 0.27, output: 1.10 },
};

/**
 * 估算文本的 Token 数量（设计期快速粗估）
 * - 空字符串 / null / undefined 返回 0
 * - 中文字符（含中文标点 \u4e00-\u9fff、\u3000-\u303f、\uff00-\uffef）按 1 token
 * - 其余字符按每 4 字符约 1 token（即每字符 0.25）
 * - 最后 Math.ceil 取整
 */
export function estimateTextTokens(text?: string | null): number {
  if (!text) return 0;
  let tokens = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}

/**
 * 获取模型定价
 * - 内置价格表，包含 5 个百炼模型标识及常用别名
 * - 未知 modelName 回退到 gpt-4o-mini
 */
export function getModelPricing(modelName: string): ModelPricing {
  return PRICING[modelName] || PRICING['gpt-4o-mini'];
}

export interface EstimateGraphNodeCostInput {
  nodeName: string;
  modelName: string;
  systemPrompt: string;
  toolSchemas?: string;
  messages?: string;
  outputText: string;
}

export interface EstimateGraphNodeCostResult {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/**
 * 估算图节点的 Token 与成本
 * - 输入文本 = systemPrompt + toolSchemas + messages 拼接后估算
 * - 输出 token = estimateTextTokens(outputText)
 * - 成本 = (inputTokens × pricing.input + outputTokens × pricing.output) / 1_000_000
 */
export function estimateGraphNodeCost(
  input: EstimateGraphNodeCostInput,
): EstimateGraphNodeCostResult {
  const inputText = [input.systemPrompt, input.toolSchemas || '', input.messages || ''].join('\n');
  const inputTokens = estimateTextTokens(inputText);
  const outputTokens = estimateTextTokens(input.outputText);
  const pricing = getModelPricing(input.modelName);

  const estimatedCostUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return { inputTokens, outputTokens, estimatedCostUsd };
}
