/**
 * scripts/run-skill-demo.ts — 第十三章 Skills 冒烟脚本
 *
 * 跑的是**真实资产与真实工具**，不是 spec 里的副本：
 *   1. 扫描 src/skills/definitions 得到 L1 索引
 *   2. 用 load_skill 加载 SKILL.md（L2），打印版本与正文长度
 *   3. 按 SKILL.md 的工作流调用本地工具，打印结构化结果
 *   4. 打印工具校验报告与加载 trace
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-skill-demo.ts
 *   # 想连真模型跑一次 ReAct 链路（需要 OPENAI_API_KEY）：
 *   RUN_SKILL_LLM_DEMO=1 npx tsx scripts/run-skill-demo.ts
 */
import { createSkillRuntime } from '../src/skills/skills-runtime.js';
import { LOAD_SKILL_TOOL_NAME } from '../src/skills/load-skill.tool.js';

const LINE = '='.repeat(78);
const DEMO_REQUIREMENT =
  '作为管理员，我需要能够批量导入用户数据，支持 CSV 和 Excel 格式，导入时自动去重。P0，要求 1000 QPS。';

function section(title: string) {
  console.log(`\n${LINE}\n${title}\n${LINE}`);
}

async function main() {
  const runtime = createSkillRuntime();
  if (!runtime) {
    console.log('SKILLS_ENABLED=0，Skills 未启用，退出。');
    return;
  }

  const { registry, tools, indexPrompt, traces, report, errors } = runtime;

  section('1. L1 索引（注入 systemPrompt 的内容）');
  console.log(indexPrompt || '（空）');

  section('2. 已注册 Skill');
  for (const s of registry.list()) {
    console.log(
      `- ${s.name} v${s.version} | 工具: ${s.allowedTools.join(', ')}`,
    );
  }
  if (errors.length > 0) {
    console.log('\n资产告警:');
    for (const e of errors) console.log(`  ! ${e}`);
  }

  section('3. 工具栈（本地 + 命中的 MCP）');
  console.log(tools.map((t) => t.name).join(', '));
  console.log(
    `\n启动校验: ok=${report?.ok} 缺失 ${report?.missingCount} 个（req_*/ws_* 属预期内缺失，需开 MCP_ENABLED）`,
  );

  section('4. load_skill 加载（L2）');
  const loadSkill = tools.find((t) => t.name === LOAD_SKILL_TOOL_NAME);
  if (!loadSkill) {
    console.log('load_skill 未装配，脚本终止');
    return;
  }

  for (const name of ['requirement-analysis', 'competitor-research', 'no-such-skill']) {
    const out = await (loadSkill as any).invoke({ skillName: name });
    const preview = out.length > 160 ? `${out.slice(0, 160)}…` : out;
    console.log(`\n[load_skill] ${name}\n${preview}`);
  }

  section('5. 按 SKILL.md 的工作流调用工具');
  const analyze = tools.find((t) => t.name === 'analyze_completeness');
  const estimate = tools.find((t) => t.name === 'estimate_complexity');
  if (analyze) {
    console.log('\n步骤 1 · analyze_completeness');
    console.log(await (analyze as any).invoke({ requirementText: DEMO_REQUIREMENT }));
  }
  if (estimate) {
    console.log('\n步骤 2 · estimate_complexity');
    console.log(await (estimate as any).invoke({ requirementText: DEMO_REQUIREMENT }));
  }

  const competitors = tools.find((t) => t.name === 'search_competitors');
  const practices = tools.find((t) => t.name === 'search_best_practices');
  if (competitors) {
    console.log('\n步骤 3 · search_competitors');
    console.log(await (competitors as any).invoke({ query: '项目管理工具' }));
  }
  if (practices) {
    console.log('\n步骤 4 · search_best_practices');
    console.log(await (practices as any).invoke({ topic: '批量导入' }));
  }

  section('6. 加载 trace（13.10.4）');
  console.log(JSON.stringify(traces.summary(), null, 2));

  // ── 可选：真模型 ReAct 链路 ────────────────────────────────
  if (process.env.RUN_SKILL_LLM_DEMO !== '1') {
    console.log(
      '\n（未设置 RUN_SKILL_LLM_DEMO=1，跳过真模型链路。零 LLM 部分已全部跑通。）',
    );
    return;
  }

  section('7. 真模型 ReAct 链路');
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const { ChatOpenAI } = await import('@langchain/openai');
  const { HumanMessage } = await import('@langchain/core/messages');

  const model = new ChatOpenAI({
    model: process.env.SKILL_DEMO_MODEL ?? 'gpt-4o-mini',
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  });
  const agent = createReactAgent({
    llm: model,
    tools,
    prompt: `你是一个产品助手。${
      indexPrompt ? `\n\n${indexPrompt}` : ''
    }\n\n加载技能后严格按照其中的工作流执行。`,
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(`帮我分析这个需求的完整性：${DEMO_REQUIREMENT}`)],
  });
  const calls = result.messages
    .filter((m: any) => m.tool_calls?.length > 0)
    .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));
  console.log(`\n调用链: ${calls.join(' → ')}`);
  console.log(`\n${result.messages.at(-1)?.content}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
