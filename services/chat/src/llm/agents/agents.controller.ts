import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import {
  OrchestratorService,
  type OrchestrationResult,
} from './orchestrator.service.js';

export interface OrchestrateDto {
  /** 待分析的用户需求描述 */
  input: string;
}

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  /**
   * POST /api/agents/orchestrate
   * 执行需求分析多 Agent 固定编排工作流：
   * 结构化抽取 -> 澄清判断 -> 并行分析与风控 -> 最终报告汇总
   */
  @Post('orchestrate')
  async orchestrate(
    @Body() body: OrchestrateDto,
  ): Promise<OrchestrationResult> {
    if (!body || typeof body.input !== 'string' || !body.input.trim()) {
      throw new BadRequestException('请求体必须包含非空的 input 字段');
    }

    return this.orchestratorService.orchestrate(body.input);
  }
}
