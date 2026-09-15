import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Sse,
  MessageEvent,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  runAnalysisGraph,
  streamAnalysisGraph,
  getAnalysisGraphMermaid,
  getAnalysisSubGraphMermaid,
  getSummarySubGraphMermaid,
  type RunAnalysisGraphOutput,
} from './requirement-analysis-graph.js';

export interface GraphAnalyzeDto {
  /** 待分析的用户需求描述文本或需求单编号 */
  input: string;
}

@Controller('api/graph')
export class GraphController {
  /**
   * GET /api/graph/stream & GET /api/graph/analysis-stream
   * 采用 Server-Sent Events (SSE) 协议按节点粒度推送图执行增量事件
   * 支持节点级流式输出，天然驱动前端步骤条 (steps) 与节点状态反馈
   *
   * @param input 待分析的用户需求描述
   * @param thread 可选会话或线程标识
   */
  @Sse('stream')
  stream(
    @Query('input') input: string,
    @Query('thread') thread?: string,
  ): Observable<MessageEvent> {
    return this.createAnalysisEventStream(input, thread);
  }

  /**
   * 需求分析流式推送别名端点
   */
  @Sse('analysis-stream')
  analysisStream(
    @Query('input') input: string,
    @Query('thread') thread?: string,
  ): Observable<MessageEvent> {
    return this.createAnalysisEventStream(input, thread);
  }

  /**
   * 构建并分发图节点流式事件的核心通道
   */
  private createAnalysisEventStream(
    input: string,
    thread?: string,
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const rawInput = input?.trim();

    // 关键步骤 1：入参非空防御性校验
    if (!rawInput) {
      setTimeout(() => {
        subject.next({
          data: JSON.stringify({
            type: 'error',
            error: '查询参数 input 不能为空',
          }),
        });
        subject.complete();
      }, 0);
      return subject.asObservable();
    }

    // 关键步骤 2：异步执行 LangGraph 节点级流式更新（streamMode: "updates"）
    (async () => {
      try {
        for await (const event of streamAnalysisGraph(rawInput)) {
          // 关键步骤 3：序列化为标准 SSE 格式数据并实时推送到客户端
          subject.next({
            data: JSON.stringify(event),
          });
        }
      } catch (err: any) {
        // 关键步骤 4：异常捕获与故障透传
        subject.next({
          data: JSON.stringify({
            type: 'error',
            error: err?.message || String(err),
          }),
        });
      } finally {
        // 关键步骤 5：流式传输完毕，关闭 Subject 完成本次 SSE 推送生命周期
        subject.complete();
      }
    })();

    return subject.asObservable();
  }
  /**
   * POST /api/graph/analyze
   * 执行 LangGraph 需求分析图（支持意图分类路由、ReAct 分析子图与 Critic-Refine 汇总闭环）
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Body() body: GraphAnalyzeDto,
  ): Promise<RunAnalysisGraphOutput> {
    const rawInput = body?.input?.trim();
    if (!rawInput) {
      throw new BadRequestException('请求体中的 input 字段不能为空');
    }

    return runAnalysisGraph(rawInput);
  }

  /**
   * GET /api/graph/mermaid
   * 获取需求分析主图的 Mermaid 流程图代码
   */
  @Get('mermaid')
  getMermaid(): { mermaid: string } {
    return {
      mermaid: getAnalysisGraphMermaid(),
    };
  }

  /**
   * GET /api/graph/subgraph-mermaid
   * 获取 ReAct 分析子图的 Mermaid 流程图代码
   */
  @Get('subgraph-mermaid')
  getSubGraphMermaid(): { mermaid: string } {
    return {
      mermaid: getAnalysisSubGraphMermaid(),
    };
  }

  /**
   * GET /api/graph/summary-mermaid
   * 获取 Critic-Refine 汇总子图的 Mermaid 流程图代码
   */
  @Get('summary-mermaid')
  getSummaryMermaid(): { mermaid: string } {
    return {
      mermaid: getSummarySubGraphMermaid(),
    };
  }
}
