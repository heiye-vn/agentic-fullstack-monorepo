/**
 * scripts/run-deepagent-analysis-demo.ts — 第十四章 14.5 / 14.9 需求分析 Agent
 *
 * 与 autix-demo 的差别：那边用 execSync 调 Python 脚本，本项目的第十三章资产是
 * TypeScript 实现（src/skills/skill-tools.ts），所以直接复用 createSkillTools()。
 *
 * 同时验证 14.9 的 Skills 接入：必须显式传 FilesystemBackend，
 * 否则默认 StateBackend 是内存态，看不见磁盘上的 SKILL.md。
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-deepagent-analysis-demo.ts
 */
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import {
  buildAnalysisTools,
  buildDeepAgentModel,
  lastText,
  requireApiKey,
  section,
  SKILLS_BACKEND_RELATIVE,
  SERVICE_ROOT,
  toolChain,
} from './deepagent-env.js';

async function main() {
  if (!requireApiKey()) return;

  const agent = createDeepAgent({
    model: buildDeepAgentModel(),
    tools: buildAnalysisTools(),
    // backend rootDir 限定到服务根目录，不暴露系统根；skills 用相对 backend root 的路径
    backend: new FilesystemBackend({ rootDir: SERVICE_ROOT, virtualMode: true }),
    skills: [SKILLS_BACKEND_RELATIVE],
    systemPrompt:
      '你是一位资深需求分析专家。需要专业能力时加载对应 skill；对用户提交的需求做完整性分析和复杂度评估，输出结构化分析报告。',
  });

  section('14.5 / 14.9 需求分析 Agent（含 Skills）');
  const result: any = await agent.invoke({
    messages: [
      {
        role: 'user',
        content:
          '分析以下需求：作为管理员，我需要能够批量导入用户数据，支持 Excel 和 CSV 格式，单次最多导入 1 万行。',
      },
    ],
  });

  console.log(`\n调用链: ${toolChain(result.messages).join(' → ') || '(无工具调用)'}`);
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
