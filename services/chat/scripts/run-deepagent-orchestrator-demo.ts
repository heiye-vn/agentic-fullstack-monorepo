/**
 * scripts/run-deepagent-orchestrator-demo.ts — 第十五章 15.3 / 15.4 跨需求编排
 *
 * 外层：DeepAgent 自己 write_todos 拆「逐需求分析 + 汇总」，用 task 委派。
 * 内层：第九章 createAnalysisGraph 作为 requirement_analyst 子 Agent，
 *       内部跑 Supervisor + 4 专家并行 + Critic-Refine，只回一条摘要。
 *
 * 用 streamEvents(v2) 实时打印：
 *   - 每次真实 LLM 调用（含子 Agent 内部第九章那张图的调用，靠适配器透传 config 才能看到）
 *   - 每次工具调用与返回
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-deepagent-orchestrator-demo.ts
 */
import {
  buildDeepAgentModel,
  lastText,
  requireApiKey,
  section,
  toolChain,
} from './deepagent-env.js';
import { createDeepOrchestrator } from '../src/llm/deepagent/deep-orchestrator.service.js';

const TASK = [
  '我们要评估以下三个需求对核心系统的总体影响，请逐个分析后给出整体结论：',
  '- REQ-001：支持企业微信扫码登录',
  '- REQ-002：订单导出支持百万行级别的异步下载',
  '- REQ-003：为后台操作增加细粒度的审计日志',
].join('\n');

const oneLine = (v: unknown, n = 100) =>
  String(typeof v === 'string' ? v : JSON.stringify(v) ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, n);

/** 工具入参在事件里被包成 { input: "<json 字符串>" }，这里拆出真实参数对象 */
function toolArgs(data: unknown): any {
  const raw = (data as any)?.input;
  const inner = raw && typeof raw === 'object' && 'input' in raw ? (raw as any).input : raw;
  if (typeof inner === 'string') {
    try {
      return JSON.parse(inner);
    } catch {
      return inner;
    }
  }
  return inner;
}

async function main() {
  if (!requireApiKey()) return;

  const model = buildDeepAgentModel();
  const agent = createDeepOrchestrator({ model });

  section('15.3 DeepAgent 跨需求协调（createAnalysisGraph 作为子 Agent）');
  console.log(TASK);
  console.log('-'.repeat(78));

  // task 委派会进入子 Agent；用计数器给子图内的步骤加缩进，便于看出层级
  let inSubagent = 0;
  const indent = () => '  '.repeat(inSubagent > 0 ? 1 : 0);
  let llmCalls = 0;
  let rootRunId: string | undefined;
  let finalState: any = null;

  for await (const ev of agent.streamEvents(
    { messages: [{ role: 'user', content: TASK }] },
    { version: 'v2' as const },
  )) {
    if (!rootRunId && ev.event === 'on_chain_start') rootRunId = ev.run_id;

    switch (ev.event) {
      case 'on_chat_model_start': {
        llmCalls++;
        const m = (ev.metadata as any)?.ls_model_name || (model as any).model || 'llm';
        console.log(`${indent()}[LLM #${llmCalls}] 模型=${m}`);
        break;
      }
      case 'on_tool_start': {
        const args = toolArgs(ev.data);
        if (ev.name === 'task') {
          inSubagent++;
          console.log(`  >> 委派子 Agent：${args?.subagent_type ?? ''} — ${oneLine(args?.description, 60)}`);
        } else {
          console.log(`${indent()}[工具] ${ev.name}  入参=${oneLine(args, 80)}`);
        }
        break;
      }
      case 'on_tool_end': {
        const out = (ev.data as any)?.output;
        const content = typeof out?.content === 'string' ? out.content : out;
        console.log(`${indent()}   <= 返回：${oneLine(content, 80)}`);
        if (ev.name === 'task') inSubagent = Math.max(0, inSubagent - 1);
        break;
      }
      case 'on_chain_end': {
        if (ev.run_id === rootRunId) finalState = (ev.data as any)?.output;
        break;
      }
    }
  }

  const messages = finalState?.messages ?? [];
  console.log(`\n真实 LLM 调用：${llmCalls} 次`);
  console.log(`主回路调用链: ${toolChain(messages).join(' → ') || '(无)'}`);
  console.log(`todos：${(finalState?.todos ?? []).length} 项`);
  console.log(`files：${Object.keys(finalState?.files ?? {}).join(', ') || '(无)'}`);

  const output = lastText(messages);
  console.log('\n总体影响评估:');
  console.log('-'.repeat(78));
  console.log(output);
  console.log('-'.repeat(78));
  console.log(`输出长度: ${output.length} 字符`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
