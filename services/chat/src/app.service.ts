import { Injectable } from '@nestjs/common';
import { APP_NAME } from '@autix/contracts';
import { PrismaService } from './prisma/prisma.service.js';

/** readiness 检查结果：ready 为 false 时 /ready 返回 503 */
export interface ReadinessResult {
  ready: boolean;
  checks: Record<string, string>;
}

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * liveness：只说明进程没崩，不代表能干活。
   * 刻意保持永远 true —— 它的失败语义是「重启 Pod」。
   */
  getHealth(): { ok: boolean } {
    return { ok: true };
  }

  /**
   * readiness（第十六章）：真探关键依赖，判断能否接流量。
   *
   * DB 是强依赖：连不上就没法读写会话与消息，此时应该被摘流而不是被重启。
   * LLM 网关刻意不探——它属于外部弱依赖，探测会拖慢健康检查（且网关抖动时
   * 我们仍希望实例留在池内做降级处理，而不是整体摘流）。若你的 SLO 要求
   * 「网关不可用即摘流」，在这里补一个带超时的探测即可。
   */
  async getReadiness(): Promise<ReadinessResult> {
    const checks: Record<string, string> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch (err) {
      checks.db = `fail: ${String(err).slice(0, 80)}`;
    }

    const ready = Object.values(checks).every((v) => v === 'ok');
    return { ready, checks };
  }

  getHello(): { message: string } {
    return {
      message: `Hello from Chat, shared APP_NAME=${APP_NAME}`,
    };
  }
}
