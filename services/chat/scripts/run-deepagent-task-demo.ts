/**
 * scripts/run-deepagent-task-demo.ts — 第十四章 14.8 task 子 Agent 委派
 *
 * 声明式 SubAgent：主 Agent 把单个需求的深度分析委托出去，子 Agent 在独立上下文里跑，
 * 只把结果摘要回传，主 Agent 负责汇总对比。task 默认是串行委派。
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-deepagent-task-demo.ts
 */
import { createDeepAgent, type SubAgent } from 'deepagents';
import {
  buildAnalysisTools,
  buildDeepAgentModel,
  lastText,
  requireApiKey,
  section,
  toolChain,
} from './deepagent-env.js';

async function main() {
  if (!requireApiKey()) return;

  const tools = buildAnalysisTools();
  const requirementAnalyst: SubAgent = {
    name: 'requirement-analyst',
    description: '对单个需求进行完整性分析、复杂度评估和风险识别',
    systemPrompt: '你是需求分析专家。请对指定需求进行完整性检查、复杂度估算和风险评估。',
    tools,
  };

  const agent = createDeepAgent({
    model: buildDeepAgentModel(),
    tools,
    subagents: [requirementAnalyst],
    systemPrompt: '你是需求分析专家。需要深入分析单个需求时，委托给 requirement-analyst 子 Agent。',
  });

  section('14.8 DeepAgent Subagent task 委派 Demo');
  const result: any = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: [
          '请分析以下两个需求：',
          'REQ-001：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式。',
          'REQ-002：订单导出支持百万行级别的异步下载。',
          '要求：',
          '1. 分别委托子 Agent 分析每个需求的完整性和复杂度。',
          '2. 主 Agent 只负责汇总两个子 Agent 的结论。',
          '3. 最终输出一个对比报告。',
        ].join('\n'),
      },
    ],
  });

  const chain = toolChain(result.messages);
  console.log(`\n调用链: ${chain.join(' → ') || '(无工具调用)'}`);
  console.log(`todos: ${(result.todos ?? []).length} 项`);
  const files = Object.keys(result.files ?? {});
  console.log(`files: ${files.join(', ') || '(无)'}`);

  const taskCount = chain.filter((t) => t === 'task').length;
  console.log(
    taskCount > 0
      ? `task 委派次数: ${taskCount}`
      : '  模型未使用 task 委派（可能直接在主 Agent 内完成了分析）',
  );

  const output = lastText(result.messages);
  console.log('\n输出:');
  console.log('-'.repeat(78));
  console.log(output);
  console.log('-'.repeat(78));
  console.log(`输出长度: ${output.length} 字符`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
