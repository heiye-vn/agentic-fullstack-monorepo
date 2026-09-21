/**
 * scripts/run-deepagent-vfs-demo.ts — 第十四章 14.7 虚拟文件系统
 *
 * 长任务的中间产物从 messages 搬到文件：写 /analysis/*.md，再 read_file 读回汇总。
 * 注意：文件内容只有被 read_file 读取时才以 ToolMessage 进入上下文，
 * 这是虚拟文件系统能压住上下文膨胀的原因。
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-deepagent-vfs-demo.ts
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
      '重要规则：你必须使用 write_file 工具将分析结果保存到文件，然后用 read_file 读取并汇总。',
    ].join('\n'),
  });

  section('14.7 DeepAgent 虚拟文件系统 Demo');
  const result: any = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: [
          '分析以下需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行。',
          '严格要求：',
          '1. 必须用 write_file 把完整性分析写入 /analysis/completeness.md',
          '2. 必须用 write_file 把复杂度估算写入 /analysis/complexity.md',
          '3. 用 read_file 读取这两个文件后汇总成报告',
        ].join('\n'),
      },
    ],
  });

  console.log(`\n调用链: ${toolChain(result.messages).join(' → ') || '(无工具调用)'}`);
  const files: Record<string, unknown> = result.files ?? {};
  const keys = Object.keys(files);
  console.log(`files: ${keys.length} 个`);
  for (const p of keys) {
    // deepagents 1.14 的 files 值是 FileData 对象（{ content, createdAt... }），
    // 低版本是纯字符串，这里两种形态都兼容
    const raw: any = files[p];
    const text = typeof raw === 'string' ? raw : (raw?.content ?? JSON.stringify(raw));
    const preview = String(text).replace(/\s+/g, ' ').slice(0, 100);
    console.log(`  ${p} (${String(text).length} 字符): ${preview}...`);
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
