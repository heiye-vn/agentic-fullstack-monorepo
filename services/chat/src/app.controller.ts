import { Body, Controller, Get, Header, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';
import { RequirementService } from './llm/requirement.service.js';
import type { RequirementResult } from '@autix/contracts';
import { registry } from './observability/index.js';

export interface ExtractRequirementDto {
  input: string;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly requirementService: RequirementService,
  ) {}

  /**
   * liveness 探针：进程还活着吗。
   * 刻意不探依赖——它对应 K8s 的 liveness，失败语义是「重启 Pod」，
   * DB 抖动时重启容器是错误动作。依赖探测见 /ready。
   */
  @Get('health')
  getHealth(): { ok: boolean } {
    return this.appService.getHealth();
  }

  /**
   * readiness 探针（第十六章）：服务现在能不能干活。
   * 真探 DB，未就绪返回 503，让负载均衡把实例摘掉而不重启它。
   */
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const result = await this.appService.getReadiness();
    res.status(result.ready ? 200 : 503).json(result);
  }

  /**
   * Prometheus 抓取端点（第十六章）：暴露进程内累加的指标。
   * 这是内网端点，生产部署时应只对监控网段/网关放行，不要直接暴露到公网。
   */
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return registry.metrics();
  }

  @Get('hello')
  getHello(): { message: string } {
    return this.appService.getHello();
  }

  @Post('requirement/extract')
  async extractRequirement(
    @Body() body: ExtractRequirementDto,
  ): Promise<RequirementResult> {
    return this.requirementService.extract(body?.input);
  }
}
