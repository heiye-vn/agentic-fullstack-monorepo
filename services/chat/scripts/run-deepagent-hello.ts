/**
 * scripts/run-deepagent-hello.ts — 第十四章 14.4 最小 DeepAgent
 *
 * 验证：一行 createDeepAgent 就自带 write_todos / 虚拟文件系统 / task 子 Agent / summarization。
 * 天气查询这种短任务通常不会触发 todos 和 files，属正常行为。
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-deepagent-hello.ts
 */
import { createDeepAgent } from 'deepagents';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  buildDeepAgentModel,
  lastText,
  requireApiKey,
  section,
  toolChain,
} from './deepagent-env.js';

const getWeather = new DynamicStructuredTool({
  name: 'get_weather',
  description: '获取指定城市的天气',
  schema: z.object({ city: z.string().describe('城市名') }),
  func: async ({ city }) => `${city}：晴，28°C，微风`,
});

async function main() {
  if (!requireApiKey()) return;

  const agent = createDeepAgent({
    model: buildDeepAgentModel(),
    tools: [getWeather],
    systemPrompt: '你是一个天气助手。用户问天气时，调用 get_weather 工具获取数据。',
  });

  section('14.4 DeepAgent Hello World');
  const result: any = await agent.invoke({
    messages: [{ role: 'user', content: '北京今天天气怎么样？' }],
  });

  console.log(`\n调用链: ${toolChain(result.messages).join(' → ') || '(无工具调用)'}`);
  console.log('\n回复:', lastText(result.messages));
  console.log('todos:', JSON.stringify(result.todos ?? [], null, 2));
  console.log('files:', Object.keys(result.files ?? {}));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
