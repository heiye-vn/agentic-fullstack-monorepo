/**
 * cost.controller.ts
 *
 * 16.4.3：把第十章的 Token 计量聚合暴露成只读查询入口。
 * 跑通主链路（或 demo）后，GET /api/cost/summary 能看到本月各节点 / 各 Agent 烧了多少 token。
 *
 * 排障提示：数据来源是第十六章 LlmTracer 落库的 token_usages，所以这个端点有没有数，
 * 取决于 LLM 回调是否真的接线（UsageSinkBootstrap）。若返回全 0，先查启动日志里
 * 有没有「LLM 计量已接线」，以及 OBS_USAGE_PERSIST 是否被设成了 0。
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import {
  TokenUsageService,
  type AgentStats,
  type MonthlyStats,
  type NodeStats,
} from './token-usage.service.js';

/** 成本总览响应体：总账 + 两张拆账表 */
export interface CostSummary {
  monthly: MonthlyStats;
  byNode: NodeStats[];
  byAgent: AgentStats[];
}

@Controller('api/cost')
@UseGuards(JwtAuthGuard)
export class CostController {
  constructor(private readonly usage: TokenUsageService) {}

  /**
   * 本月总账 + 按节点 / 按 Agent 的成本拆账。
   * 三个聚合查询互不依赖，并行发出，省掉两轮串行等待。
   */
  @Get('summary')
  async summary(): Promise<CostSummary> {
    const [monthly, byNode, byAgent] = await Promise.all([
      this.usage.getMonthlyStats(),
      this.usage.getStatsByNode(),
      this.usage.getStatsByAgent(),
    ]);
    return { monthly, byNode, byAgent };
  }
}
