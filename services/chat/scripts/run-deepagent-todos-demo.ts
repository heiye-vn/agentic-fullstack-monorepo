/**
 * scripts/run-deepagent-todos-demo.ts — 第十四章 14.6 write_todos 规划
 *
 * 关键点：write_todos 是引导式而非强制。要让规划稳定出现，业务 system prompt 必须
 * 明确点名 write_todos（内置 prompt 只做鼓励，遇到"直接回答"类指令会被压过去）。
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-deepagent-todos-demo.ts
 */
import { createDeepAgent } from 'deepagents';
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

  const agent = createDeepAgent({
    model: buildDeepAgentModel(),
    tools: buildAnalysisTools(),
    systemPrompt: [
      '你是一位资深需求分析专家。',
      '重要规则：面对多步骤任务时，必须先使用 write_todos 制定任务计划，再逐步执行。',
    ].join('\n'),
  });

  section('14.6 write_todos 规划 Demo');
  const result: any = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: [
          '请对以下需求进行完整分析，要求分三个阶段：',
          '阶段一：完整性检查（调用 analyze_completeness）',
          '阶段二：复杂度估算（调用 estimate_complexity）',
          '阶段三：综合以上两个维度，输出结构化分析报告',
          '',
          '需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行，导入失败的行需要生成错误报告。',
        ].join('\n'),
      },
    ],
  });

  console.log(`\n调用链: ${toolChain(result.messages).join(' → ') || '(无工具调用)'}`);
  const todos = result.todos ?? [];
  console.log(`todos: ${todos.length} 项`);
  if (todos.length > 0) {
    for (const t of todos) console.log(`  [${t.status}] ${t.content}`);
  } else {
    console.log('  模型未使用 write_todos（任务可能被判定为不需要规划）');
  }

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
