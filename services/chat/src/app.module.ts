import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';
import { AdvancedModule } from './llm/advanced.module.js';
import { UIProtocolModule } from './llm/ui-protocol/ui-protocol.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MessageModule } from './message/message.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DocumentModule } from './document/document.module.js';
import { SseModule } from './sse/sse.module.js';
import { ArtifactModule } from './artifact/artifact.module.js';
import { ModelConfigModule } from './model-config/model-config.module.js';
import { TraceMiddleware, UsageSinkBootstrap } from './observability/index.js';
import { getSharedMcpManager } from './mcp/mcp-runtime.js';
import { getSharedSkillRuntime } from './skills/skills-runtime.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret:
        process.env.JWT_SECRET ||
        'autix_rbac_jwt_secret_key_2026_super_secure',
    }),
    PrismaModule,
    MessageModule,
    ConversationModule,
    DocumentModule,
    LlmModule,
    AdvancedModule,
    UIProtocolModule,
    SseModule,
    ArtifactModule,
    ModelConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService, UsageSinkBootstrap],
})
export class AppModule implements NestModule, OnApplicationBootstrap {
  /**
   * 第十六章：在请求入口建立 traceId 上下文（ALS），让同一次请求的
   * HTTP access 日志、LangGraph 节点日志、LLM 调用日志共用同一个 traceId。
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }

  /**
   * 第二十章 20.4 / 20.5：把 MCP 和 Skills 在**启动期**预热好。
   *
   * 两者本来就是进程级幂等单例，首个请求也会触发装配 —— 那为什么还要预热？
   *   1. 启动期就把「MCP 连不上 / SKILL.md 写坏」暴露出来，而不是等到用户问出
   *      第一句话才发现能力是缺的（可观测性里"早失败好过晚失败"）；
   *   2. 避免第一轮对话白白多承担一次 InMemory 握手与目录扫盘的耗时。
   *
   * 这里**刻意不 await 失败重抛**：MCP / Skills 都是增强项，
   * 它们不可用应当降级而不是阻止服务启动（第八章「依赖失败变有类型降级」）。
   */
  async onApplicationBootstrap(): Promise<void> {
    let mcpToolNames: string[] = [];
    let mcp: Awaited<ReturnType<typeof getSharedMcpManager>> = null;

    try {
      mcp = await getSharedMcpManager();
      mcpToolNames = mcp ? mcp.getTools().map((t) => t.name) : [];
      console.log(
        `[20.4] MCP ${mcp ? '已启用' : '未启用'}，可用工具：[${mcpToolNames.join(', ') || '(none)'}]`,
      );
    } catch (err) {
      console.warn(
        '[20.4] MCP 启动期预热失败，专家将降级使用本地 Mock 工具:',
        err instanceof Error ? err.message : String(err),
      );
    }

    try {
      // ⚠️ 顺序很重要：Skill 工具栈要混合第十二章的 MCP 工具（教程 13.9.1），
      // 而 getSharedSkillRuntime 是**进程级缓存**，opts 只在首次调用生效。
      // 如果这里不带 mcpTools 先预热，缓存就被固化成「没有 MCP 工具」的版本，
      // 后续 ChatStreamService 再传 mcpTools 也拿不到 —— 技能声明的 req_*/ws_* 会永远缺失。
      const skills = getSharedSkillRuntime({
        mcpTools: mcp?.getTools(),
        logger: (m: string) => console.log(`[skills] ${m}`),
      });
      if (skills && skills.errors.length > 0) {
        for (const e of skills.errors) console.warn(`[20.5] ${e}`);
      }
      console.log(
        `[20.5] Skills ${skills ? '已启用' : '未启用'}，已注册：[${skills?.registry.names().join(', ') || '(none)'}]`,
      );
    } catch (err) {
      console.warn(
        '[20.5] Skills 启动期预热失败，专家将不带方法论上下文:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
