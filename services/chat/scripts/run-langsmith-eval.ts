/**
 * scripts/run-langsmith-eval.ts
 *
 * 在 LangSmith 上跑 Experiment：读 Dataset → target 跑**真实链路** → evaluators 打分。
 * 跑完可在 LangSmith UI 里逐 case 看 trace、分数、评语。
 *
 * 与 autix 那版最大的差别：**target 走真实检索**。
 * autix 的实现里写死了 `retrievedContext: '（LangSmith 评测模式：无检索上下文）'`，
 * 等于托管平台上评的是「无 RAG 的裸生成」，和本地 runner 评的根本不是同一条链路 ——
 * 两边分数对不上时无法判断是平台的问题还是 RAG 的问题。这里两边刻意保持一致。
 *
 * 前置：
 *   1. .env 配好 LANGSMITH_API_KEY / OPENAI_API_KEY
 *   2. 已跑过 scripts/seed-eval-corpus.ts（检索要用 golden 语料）
 *   3. 已跑过 scripts/sync-langsmith-dataset.ts 上传数据集
 *
 * 运行（Windows 下 pnpm 需要 NODE_OPTIONS= 前缀）：
 *   cd services/chat
 *   NODE_OPTIONS= pnpm exec tsx scripts/run-langsmith-eval.ts
 *   NODE_OPTIONS= pnpm exec tsx scripts/run-langsmith-eval.ts --prefix=topK8-test
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { evaluate } from 'langsmith/evaluation';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { EmbeddingService } from '../src/document/embedding.service.js';
import { SearchService } from '../src/document/search.service.js';
import { runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph.js';
import { createChatModel } from '../src/llm/model.factory.js';
import { judgeReport } from '../src/eval/judge.js';
import { resolveJudgeModel } from '../src/eval/resolve-judge-model.js';
import { EVAL_USER_ID } from '../src/eval/dataset-loader.js';
import { recallAtK, precisionAtK } from '../src/rag/evaluation/retrieval-metrics.js';

const DATASET_NAME = 'autix-requirement-analysis';
const TOP_K = 5;

function getPrefix(): string {
  const arg = process.argv.find((a) => a.startsWith('--prefix='));
  return arg ? arg.split('=')[1] : `eval-${new Date().toISOString().slice(0, 10)}`;
}

async function main() {
  for (const key of ['LANGSMITH_API_KEY', 'OPENAI_API_KEY']) {
    if (!process.env[key]) {
      console.error(`❌ 缺少 ${key}，请先在 .env 中配置`);
      process.exit(1);
    }
  }

  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres123@localhost:5432/autix_chat?schema=public';
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const search = new SearchService(prisma as any, new EmbeddingService());

  // 被测模型（subject）与 judge 模型刻意分开，避免自查自纠
  const subjectModel = createChatModel({ temperature: 0, streaming: false });
  const judge = await resolveJudgeModel(prisma);

  const prefix = getPrefix();
  console.log(`▶ LangSmith Experiment: ${prefix}`);
  console.log(`  Dataset   : ${DATASET_NAME}`);
  console.log(`  被测模型  : ${subjectModel.model}`);
  console.log(`  judge 模型: ${judge.name}（来源 ${judge.source}）`);
  if (judge.source === 'default') {
    console.warn('  ⚠️  judge 没能用上 critic 档，分数与本地 runner 可能不可比');
  }

  // target：真实检索 → 喂上下文 → 跑真实图
  async function target(inputs: { input?: string }): Promise<Record<string, unknown>> {
    const input = String(inputs?.input ?? '');
    const retrieved = await search.similaritySearch(input, EVAL_USER_ID, TOP_K);
    const context =
      retrieved.length === 0
        ? '无相关参考文档'
        : retrieved
            .map((r, i) => `[文档片段 ${i + 1}]（相关度：${r.score.toFixed(3)}）\n${r.content}`)
            .join('\n\n');

    const out = await runAnalysisGraph({ input, retrievedContext: context }, { model: subjectModel });

    return {
      intent: out.intent,
      summary: out.summary ?? '',
      retrievedIds: retrieved.map((r) => r.id),
    };
  }

  // evaluator 1：LLM-as-judge 报告质量（复用本地同一套 rubric）
  async function reportQuality({ outputs }: any) {
    const summary = String(outputs?.summary ?? '');
    if (summary.trim().length === 0) {
      return { key: 'report_quality', score: 0, comment: '无报告' };
    }
    const j = await judgeReport(judge.model, summary);
    return {
      key: 'report_quality',
      score: j.totalScore / 100,
      comment: `总分 ${j.totalScore}${j.passed ? '' : '（未过 rubric gate）'} | ${j.critique}`,
    };
  }

  // evaluator 2：triage 准确率（确定性）
  function intentMatch({ outputs, referenceOutputs }: any) {
    const expected = referenceOutputs?.expectedIntent;
    if (!expected) return { key: 'intent_correct', score: null };
    return {
      key: 'intent_correct',
      score: outputs?.intent === expected ? 1 : 0,
      comment: `实际 ${outputs?.intent} / 期望 ${expected}`,
    };
  }

  // evaluator 3/4：检索质量（确定性）。这是 autix 版漏掉的两个 ——
  // 没有它们就只能在平台上看到「生成质量」，看不到 RAG 召回是否退化。
  function retrievalRecall({ outputs, referenceOutputs }: any) {
    const relevant: string[] = referenceOutputs?.relevantChunkIds ?? [];
    if (relevant.length === 0) return { key: 'retrieval_recall', score: null };
    const score = recallAtK(outputs?.retrievedIds ?? [], relevant, TOP_K);
    return {
      key: 'retrieval_recall',
      score,
      comment: `topK=${TOP_K}，相关 ${relevant.length} 条`,
    };
  }

  function retrievalPrecision({ outputs, referenceOutputs }: any) {
    const relevant: string[] = referenceOutputs?.relevantChunkIds ?? [];
    if (relevant.length === 0) return { key: 'retrieval_precision', score: null };
    const score = precisionAtK(outputs?.retrievedIds ?? [], relevant, TOP_K);
    return {
      key: 'retrieval_precision',
      score,
      comment: `分母是实际返回数，受 topK 影响`,
    };
  }

  await evaluate(target as any, {
    data: DATASET_NAME,
    evaluators: [reportQuality, intentMatch, retrievalRecall, retrievalPrecision] as any,
    experimentPrefix: prefix,
    maxConcurrency: 2,
    metadata: {
      subjectModel: subjectModel.model,
      judgeModel: judge.name,
      judgeSource: judge.source,
      rubricVersion: 1,
      topK: TOP_K,
      gitSha: process.env.GIT_SHA ?? 'local',
      chapter: '17',
    },
  });

  await prisma.$disconnect();
  await pool.end();

  console.log('\n✅ Experiment 完成！');
  console.log(`   https://smith.langchain.com → Datasets → ${DATASET_NAME} → Experiments`);
  console.log(`   实验名前缀：${prefix}`);
}

main().catch((err: unknown) => {
  console.error('❌ experiment 失败：', (err as Error).message ?? err);
  process.exit(1);
});
