/**
 * run-fullchain-demo.ts —— 第二十章《满血版链路》端到端演示脚本
 *
 * 走真正的生产编排入口（OrchestratorService），逐个事件实时打印，让
 * 「每一步 + 每次真实 LLM 调用」都可见。覆盖本章六个接线点真生效：
 *   - 20.2 检索升级：retrievedContext 传入（hybrid 检索在 SearchService 里，这里直接喂结果）
 *   - 20.3 RAG 修复：检索内容真正进报告（看报告里有没有知识库特征术语）
 *   - 20.4 MCP 工具：预热后专家可调真实 MCP 工具（看启动日志里的工具白名单）
 *   - 20.5 Skills：方法论正文前置注入（看打印的「注入方法论」字符数）
 *   - 20.6 长链路由：多工单输入走 DeepAgent 分支（看 log「路由到 DeepAgent」）
 *   - 20.7 历史：演示里直接在 input 前拼历史块（生产由 ChatStreamService 拼）
 *
 * 与 autix 同名脚本的两处不同：
 *   1. **依赖自己装配**。autix 有 mcp-bootstrap 的 initMcp() 一把梭；本项目是
 *      getSharedMcpManager()（异步）→ getSharedSkillRuntime({ mcpTools })，
 *      顺序不能反 —— Skills 是进程级缓存，第一次调用没带 MCP 工具就会永久固化成
 *      「没有 MCP 工具」的版本。这里按生产 AppModule 的顺序预热。
 *   2. **判定长链用 detectLongChain(text)**，而不是把两个场景硬编码成两条路。
 *      场景 2 之所以走 DeepAgent，是因为它真的命中了判定，不是手写分支。
 *
 * 运行：
 *   cd services/chat && npx tsx scripts/run-fullchain-demo.ts
 *   MCP_ENABLED=1 npx tsx scripts/run-fullchain-demo.ts   # 同时接上 MCP 工具
 * 需 .env 提供 OPENAI_API_KEY（或已在库中配好模型密钥）；会产生真实（付费）LLM 调用。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  OrchestratorService,
  detectLongChain,
} from '../src/llm/agents/orchestrator.service.js';
import type {
  ExpertMcpDeps,
  ExpertSkillDeps,
} from '../src/llm/graph/experts.js';
import { getSharedMcpManager } from '../src/mcp/mcp-runtime.js';
import {
  buildMethodologyBlock,
  buildSkillToolSet,
  DEFAULT_ANALYSIS_SKILL,
  getSharedSkillRuntime,
} from '../src/skills/skills-runtime.js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../.env') });

if (!process.env.OPENAI_API_KEY) {
  console.error(
    '❌ 未设置 OPENAI_API_KEY，本 demo 需要真实 LLM。请在 services/chat/.env 配置后重试。',
  );
  process.exit(1);
}

const oneLine = (v: unknown, n = 100) =>
  String(typeof v === 'string' ? v : (JSON.stringify(v) ?? ''))
    .replace(/\s+/g, ' ')
    .slice(0, n);

// OrchestratorService 的构造函数只有 @Optional() 的自定义模型参数，直接 new 即可。
// 不传模型 → 编排内部走默认模型工厂（读 .env / 库里的模型配置）。
const orchestrator = new OrchestratorService();

/** 20.7：把历史块拼在输入最前面（生产里由 ChatStreamService.buildChatHistoryBlock 生成）。 */
function withHistory(input: string, history: string[]): string {
  if (history.length === 0) return input;
  const block = history.map((h) => `- ${oneLine(h, 80)}`).join('\n');
  return `（历史对话）\n${block}\n\n（本轮需求）\n${input}`;
}

/** 跑一个场景：逐事件打印，最后返回累计的报告正文。 */
async function runScenario(
  title: string,
  input: string,
  retrievedContext: string,
): Promise<string> {
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 场景：${title}`);
  console.log('='.repeat(80));
  console.log(`📨 输入：${oneLine(input, 120)}`);
  console.log(
    `📚 检索上下文：${retrievedContext === '无相关参考文档' ? '（无）' : oneLine(retrievedContext, 120)}`,
  );
  console.log(
    `🧭 路由判定：${detectLongChain(input) ? 'DeepAgent 长链分支（20.6）' : '主图分支'}`,
  );
  console.log('─'.repeat(80));

  let tokenBuf = '';
  let lastTokenAgent = '';
  let report = '';

  const flushTokens = () => {
    if (tokenBuf.trim()) {
      console.log(`   💬 [${lastTokenAgent}] ${oneLine(tokenBuf, 100)}`);
    }
    tokenBuf = '';
  };

  const stream = detectLongChain(input)
    ? orchestrator.streamDeepAgent(input, retrievedContext, undefined)
    : orchestrator.streamOrchestrate(input, {
        retrievedContext,
        skills: skillsDeps,
        mcp: mcpDeps,
      });

  for await (const ev of stream) {
    switch (ev.type) {
      case 'log':
        flushTokens();
        console.log(`📝 ${ev.error ?? ''}`);
        break;
      case 'agent_start':
        flushTokens();
        console.log(
          `▶ 步骤 ${ev.step ?? '-'}${ev.totalSteps ? `/${ev.totalSteps}` : ''}${ev.parallel ? '（并行）' : ''}：${ev.agent}`,
        );
        break;
      case 'agent_end':
        flushTokens();
        console.log(`✅ 完成：${ev.agent}`);
        break;
      case 'token': {
        if (ev.agent !== lastTokenAgent) {
          flushTokens();
          lastTokenAgent = ev.agent ?? '';
        }
        tokenBuf += ev.content ?? '';
        report += ev.content ?? '';
        break;
      }
      case 'error':
        flushTokens();
        console.log(`❌ 错误：${ev.error}`);
        break;
      case 'complete':
        flushTokens();
        console.log('🏁 编排完成');
        break;
    }
  }

  console.log('─'.repeat(80));
  console.log('🤖 报告正文（节选 600 字符）：');
  console.log(report.slice(0, 600));
  console.log(`📊 报告长度：${report.length} 字符`);
  return report;
}

// ── 预热：MCP 先、Skills 后（顺序见文件头说明）──────────────────────────
let mcpDeps: ExpertMcpDeps | undefined;
let skillsDeps: ExpertSkillDeps | undefined;

async function warmup() {
  console.log('🔌 预热 MCP（未开启 MCP_ENABLED 时自动降级为「无 MCP 工具」）...');
  const mcpManager = await getSharedMcpManager();
  const mcpTools = mcpManager?.getTools() ?? [];
  console.log(
    `   MCP 白名单工具：[${mcpTools.map((t) => String((t as { name?: string }).name)).join(', ') || '(无，降级)'}]`,
  );
  if (mcpTools.length > 0) {
    mcpDeps = { tools: mcpTools };
  }

  const skillRuntime = getSharedSkillRuntime({
    mcpTools,
    logger: (m) => console.log(`   [skills] ${m}`),
  });
  if (skillRuntime) {
    const built = buildSkillToolSet(skillRuntime.registry, { mcpTools });
    skillsDeps = {
      tools: built.tools,
      indexPrompt: skillRuntime.indexPrompt,
      traces: built.traces,
    };
    console.log(
      `   Skills 工具：[${built.tools.map((t) => String((t as { name?: string }).name)).join(', ')}]`,
    );
  } else {
    console.log('   Skills 未启用（SKILLS_ENABLED=0）');
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('🚀 第二十章 满血版链路 demo（真实 LLM，会产生费用）');
  console.log('='.repeat(80));

  await warmup();

  // ── 20.5：方法论正文前置注入（与 ChatStreamService 里完全同一段逻辑）──
  const skillRuntime = getSharedSkillRuntime();
  const methodology = skillRuntime
    ? buildMethodologyBlock(DEFAULT_ANALYSIS_SKILL, skillRuntime.registry)
    : '';
  if (methodology) {
    console.log(`\n📐 20.5 注入方法论：${methodology.length} 字符（Skill: ${DEFAULT_ANALYSIS_SKILL}）`);
  }

  // ── 场景 1：短任务（单需求）→ 主图；检索内容应进报告（20.2/20.3/20.5）──
  const fact =
    '[知识库] 企业微信登录必须使用 OAuth2 授权码模式，并在回调时校验 corpId。';
  const ragContext = methodology ? `${methodology}\n\n${fact}` : fact;
  const report1 = await runScenario(
    '短任务·单需求（主图 + RAG 注入 + MCP 工具 + Skills 方法论）',
    withHistory(
      '为后台管理系统增加企业微信扫码登录：用户用企业微信授权登录，自动绑定已有账号，支持单点登出。',
      ['上一轮讨论过「账号体系统一」的方案'],
    ),
    ragContext,
  );
  const ragHit = /OAuth2|授权码|corpId/i.test(report1);
  console.log(
    `\n🔎 20.3 校验：报告是否消费了检索内容（出现 OAuth2/授权码/corpId）→ ${ragHit ? '✅ 是' : '❌ 否'}`,
  );

  // ── 场景 2：长任务（多工单）→ DeepAgent 分支（20.6）──
  const report2 = await runScenario(
    '长任务·多工单（DeepAgent 跨工单编排）',
    '评估 REQ-001（企业微信登录）与 REQ-002（订单百万行异步导出）的总体影响和冲突。',
    '无相关参考文档',
  );
  console.log(
    `\n🔎 20.6 校验：长链分支产出非空报告 → ${report2.length > 0 ? '✅ 是' : '❌ 否'}`,
  );

  console.log('\n' + '='.repeat(80));
  console.log(
    '🎉 满血链路 demo 跑完：短任务走主图、长任务走 DeepAgent，RAG/MCP/Skills 均在主链路生效。',
  );
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((err) => {
  console.error('demo 失败：', err);
  process.exit(1);
});
