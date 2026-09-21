/**
 * usage-sink.provider.ts
 *
 * 把 NestJS 侧的 TokenUsageService（依赖 PrismaService）接到 LLM 回调的落库出口上。
 *
 * 为什么需要这个桥：模型实例由纯函数 createChatModel() 创建，那里没有 DI 容器，
 * 拿不到 Prisma。所以用「模块初始化时注入一次」的方式把 sink 交给全局单例 Tracer。
 *
 * 关闭落库：设 OBS_USAGE_PERSIST=0（只保留日志与 Prometheus 指标，不写库）。
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TokenUsageService } from '../llm/cost/token-usage.service.js';
import { setUsageSink } from './llm-tracer.js';

@Injectable()
export class UsageSinkBootstrap implements OnModuleInit {
  private readonly logger = new Logger(UsageSinkBootstrap.name);

  constructor(private readonly tokenUsage: TokenUsageService) {}

  onModuleInit(): void {
    if (process.env.OBS_USAGE_PERSIST === '0') {
      this.logger.warn(
        'OBS_USAGE_PERSIST=0：LLM 调用只出日志与 llm_* 指标，不写 token_usages',
      );
      setUsageSink(null);
      return;
    }

    setUsageSink(this.tokenUsage);
    this.logger.log(
      'LLM 计量已接线：每次模型调用写一条 token_usages，并累加 llm_* 指标',
    );
  }
}
