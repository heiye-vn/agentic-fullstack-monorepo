import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * 节点级 Token Usage 写入记录接口
 */
export interface TokenUsageRecord {
  id?: string;
  conversationId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  graphName: string;
  nodeName: string;
  agentName: string;
  modelConfigId?: string | null;
  modelName: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number | null;
  cachedInputTokens?: number;
  estimatedCostUsd?: number;
  isEstimated?: boolean;
  latencyMs?: number;
  overrideReason?: string | null;
  createdAt?: Date;
}

/**
 * 月度统计汇总数据
 */
export interface MonthlyStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  calls: number;
}

/**
 * 节点级统计明细
 */
export interface NodeStats {
  nodeName: string;
  totalCost: number;
  calls: number;
  /** 平均输入 Token —— 用于定位"哪个节点上下文最重" */
  avgInputTokens: number;
}

/**
 * Agent 级统计明细
 */
export interface AgentStats {
  agentName: string;
  totalCost: number;
  calls: number;
}

/**
 * 节点级 Token Usage 采集与持久化服务
 */
export class TokenUsageService {
  constructor(private prisma: PrismaClient) {}

  /**
   * 记录单次节点模型调用 Usage（非阻塞容错，异常仅 warn 不向外抛出）
   */
  async recordUsage(record: TokenUsageRecord): Promise<void> {
    try {
      const inputTokens = record.inputTokens ?? 0;
      const outputTokens = record.outputTokens ?? 0;
      const totalTokens = record.totalTokens ?? (inputTokens + outputTokens);

      await this.prisma.tokenUsage.create({
        data: {
          conversationId: record.conversationId,
          messageId: record.messageId,
          threadId: record.threadId,
          graphName: record.graphName,
          nodeName: record.nodeName,
          agentName: record.agentName,
          modelConfigId: record.modelConfigId,
          modelName: record.modelName,
          provider: record.provider || 'openai',
          inputTokens,
          outputTokens,
          totalTokens,
          cachedInputTokens: record.cachedInputTokens ?? 0,
          estimatedCostUsd: record.estimatedCostUsd ?? 0,
          isEstimated: record.isEstimated ?? false,
          latencyMs: record.latencyMs ?? 0,
          overrideReason: record.overrideReason,
        },
      });
    } catch (err) {
      console.warn('[TokenUsageService] recordUsage failed, skipping:', err);
    }
  }

  /**
   * 获取当月 Token 消耗聚合统计（自当月 1 日零点起）
   */
  async getMonthlyStats(): Promise<MonthlyStats> {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const records = await this.prisma.tokenUsage.findMany({
      where: { createdAt: { gte: monthStart } },
    });

    return {
      totalCost: records.reduce((s, r) => s + (r.estimatedCostUsd || 0), 0),
      totalInputTokens: records.reduce((s, r) => s + (r.inputTokens || 0), 0),
      totalOutputTokens: records.reduce((s, r) => s + (r.outputTokens || 0), 0),
      totalCachedTokens: records.reduce((s, r) => s + (r.cachedInputTokens || 0), 0),
      calls: records.length,
    };
  }

  /**
   * 按 nodeName 聚合总成本、调用次数与平均输入 Token，并按总成本降序排列
   */
  async getStatsByNode(): Promise<NodeStats[]> {
    const records = await this.prisma.tokenUsage.findMany();
    const map = new Map<string, { totalCost: number; calls: number; inputTokens: number }>();

    for (const r of records) {
      const item = map.get(r.nodeName) || { totalCost: 0, calls: 0, inputTokens: 0 };
      item.totalCost += r.estimatedCostUsd || 0;
      item.calls += 1;
      item.inputTokens += r.inputTokens || 0;
      map.set(r.nodeName, item);
    }

    return Array.from(map.entries())
      .map(([nodeName, v]) => ({
        nodeName,
        totalCost: v.totalCost,
        calls: v.calls,
        avgInputTokens: v.calls > 0 ? Math.round(v.inputTokens / v.calls) : 0,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * 按 agentName 聚合总成本与调用次数，并按总成本降序排列
   */
  async getStatsByAgent(): Promise<AgentStats[]> {
    const records = await this.prisma.tokenUsage.findMany();
    const map = new Map<string, AgentStats>();

    for (const r of records) {
      const item = map.get(r.agentName) || { agentName: r.agentName, totalCost: 0, calls: 0 };
      item.totalCost += r.estimatedCostUsd || 0;
      item.calls += 1;
      map.set(r.agentName, item);
    }

    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * 检查当月总支出是否触达或超出预算上限
   */
  async isOverBudget(monthlyBudgetUsd: number): Promise<boolean> {
    const stats = await this.getMonthlyStats();
    return stats.totalCost >= monthlyBudgetUsd;
  }
}
