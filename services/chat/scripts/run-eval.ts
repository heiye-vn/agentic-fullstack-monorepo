/**
 * scripts/run-eval.ts
 *
 * 统一评测 runner（第十七章 17.7）
 *
 * 流程：读数据集 → 每个 case 真检索 + 过真实图 → 算指标/judge
 *      → 分桶聚合 → 出报告(JSON/CSV) → 落 eval_runs → 阈值门禁（非 0 退出码供 CI 当闸门）
 *
 * 用法（Windows 下 pnpm 需要 NODE_OPTIONS= 前缀）：
 *   cd services/chat
 *   NODE_OPTIONS= pnpm exec tsx scripts/run-eval.ts --no-llm      # 只跑检索指标（便宜、确定）
 *   NODE_OPTIONS= pnpm exec tsx scripts/run-eval.ts               # 全量：检索 + 真图 + judge
 *   NODE_OPTIONS= pnpm exec tsx scripts/run-eval.ts --case=req-login-001
 *   RUN_RAGAS=1 NODE_OPTIONS= ...                                 # 附加 RAGAS faithfulness
 *
 * 前置：先跑 scripts/seed-eval-corpus.ts 灌入 golden 语料（检索指标依赖它）。
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { EmbeddingService } from '../src/document/embedding.service.js';
import { SearchService } from '../src/document/search.service.js';
import { runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph.js';
import { createChatModel } from '../src/llm/model.factory.js';
import { judgeReport } from '../src/eval/judge.js';
import { resolveJudgeModel } from '../src/eval/resolve-judge-model.js';
import { loadRubric } from '../src/eval/rubric-loader.js';
import { loadDataset, EVAL_USER_ID, type EvalCase } from '../src/eval/dataset-loader.js';
import {
  precisionAtK,
  recallAtK,
  ndcgAtK,
  reciprocalRank,
} from '../src/rag/evaluation/retrieval-metrics.js';
import { runRagas } from '../src/rag/evaluation/ragas-runner.js';
import {
  aggregate,
  gateDecision,
  describeGateFailures,
  DEFAULT_GATE,
  OVERALL_BUCKET,
  type CaseResult,
  type EvalSummary,
} from '../src/rag/evaluation/aggregate.js';

const TOP_K = 5;
const DATASET_NAME = 'requirement-analysis';
const REPORTS_DIR = fileURLToPath(new URL('../src/eval/reports/', import.meta.url));

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const noLlm = args.includes('--no-llm');
const caseArg = args.find((a) => a.startsWith('--case='))?.split('=')[1];
const enableRagas = process.env.RUN_RAGAS === '1';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres123@localhost:5432/autix_chat?schema=public';
const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 中英混排下的显示宽度：CJK 字符占两列，直接 padEnd 会让表格错位 */
function displayWidth(s: string): number {
  return [...s].reduce(
    (w, ch) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1),
    0,
  );
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

function gitSha(): string | undefined {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

function formatContext(results: Array<{ content: string; score: number }>): string {
  if (results.length === 0) return '无相关参考文档';
  return results
    .map((r, i) => `[文档片段 ${i + 1}]（相关度：${r.score.toFixed(3)}）\n${r.content}`)
    .join('\n\n');
}

function fmt(v: number | undefined): string {
  return v === undefined ? '   -  ' : v.toFixed(3).padStart(6);
}

function printTable(summary: EvalSummary): void {
  const rows = [...summary.buckets, summary.overall];
  const label = (b: string) => (b === OVERALL_BUCKET ? '全量平均' : b);
  // 桶名宽度按最长的一个动态算：tag 名长短差别很大（auth vs needs-clarification），
  // 写死宽度会让长 tag 把后面的列顶歪
  const nameWidth = Math.max(8, ...rows.map((r) => displayWidth(label(r.bucket)))) + 2;

  console.log(
    '\n' +
      pad('维度', nameWidth) +
      pad('n', 5) +
      pad('failed', 7) +
      pad('Recall', 8) +
      pad('Prec', 8) +
      pad('NDCG', 8) +
      pad('MRR', 8) +
      pad('Intent', 8) +
      'Judge',
  );
  console.log('─'.repeat(74));
  for (const r of rows) {
    const judge = r.judgeScore === undefined ? '   -  ' : String(Math.round(r.judgeScore)).padStart(5);
    console.log(
      pad(label(r.bucket), nameWidth) +
        pad(String(r.n), 5) +
        pad(String(r.failed), 7) +
        pad(fmt(r.recall), 8) +
        pad(fmt(r.precision), 8) +
        pad(fmt(r.ndcg), 8) +
        pad(fmt(r.mrr), 8) +
        pad(fmt(r.intentCorrect), 8) +
        judge,
    );
  }
  console.log('─'.repeat(74));
}

function writeReport(summary: EvalSummary, results: CaseResult[]): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = `${REPORTS_DIR}${ts}.json`;
  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2), 'utf-8');

  const header = 'bucket,n,failed,recall,precision,ndcg,mrr,intentCorrect,judgeScore,faithfulness';
  const rows = [...summary.buckets, summary.overall].map((b) =>
    [
      b.bucket,
      b.n,
      b.failed,
      b.recall ?? '',
      b.precision ?? '',
      b.ndcg ?? '',
      b.mrr ?? '',
      b.intentCorrect ?? '',
      b.judgeScore ?? '',
      b.faithfulness ?? '',
    ].join(','),
  );
  writeFileSync(`${REPORTS_DIR}${ts}.csv`, [header, ...rows].join('\n'), 'utf-8');
  return jsonPath;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function runOneCase(
  c: EvalCase,
  search: SearchService,
  subjectModel: any,
  judgeModel: any,
): Promise<CaseResult> {
  const r: CaseResult = { id: c.id, tags: c.tags, metrics: {} };

  // 1) 真检索：本地 embedding + pgvector 余弦，确定且便宜
  const retrieved = await search.similaritySearch(c.input, EVAL_USER_ID, TOP_K);
  const retrievedIds = retrieved.map((x) => x.id);

  // 2) 检索指标（只有标了 ground truth 的 case 才算）
  const relevant = c.relevantChunkIds ?? [];
  if (relevant.length > 0) {
    r.metrics.recall = recallAtK(retrievedIds, relevant, TOP_K);
    r.metrics.precision = precisionAtK(retrievedIds, relevant, TOP_K);
    r.metrics.ndcg = ndcgAtK(retrievedIds, relevant, TOP_K);
    r.metrics.rr = reciprocalRank(retrievedIds, relevant);
  }

  if (!noLlm) {
    // 3) 过真实图，喂入刚才真检索拼好的上下文
    const output = await runAnalysisGraph(
      { input: c.input, retrievedContext: formatContext(retrieved) },
      { model: subjectModel },
    );

    // 4) triage 准确率。注意图还会输出 'risk_only' 这一支（数据集中未标注），
    //    出现时按「不匹配」计，避免悄悄放宽判定口径。
    r.metrics.intentCorrect = output.intent === c.expectedIntent ? 1 : 0;

    // 5) LLM-as-judge（只有 analyze 类才会产出报告）
    const summary = typeof output.summary === 'string' ? output.summary : '';
    if (c.expectedIntent === 'analyze' && summary.trim().length > 0) {
      const j = await judgeReport(judgeModel, summary);
      r.metrics.judgeScore = j.totalScore;
      r.judgePassed = j.passed;

      // 6) faithfulness（仅 RUN_RAGAS=1；服务不可达时 runRagas 返回 null，自动跳过）
      if (enableRagas && retrieved.length > 0) {
        const ragas = await runRagas({
          samples: [
            {
              question: c.input,
              answer: summary,
              contexts: retrieved.map((x) => x.content),
              ground_truth: c.groundTruthAnswer,
            },
          ],
          metrics: ['faithfulness'],
        });
        if (ragas && typeof ragas.faithfulness === 'number') {
          r.metrics.faithfulness = ragas.faithfulness;
        }
      }
    }
  }

  return r;
}

async function main() {
  const cases = loadDataset(DATASET_NAME).filter((c) => !caseArg || c.id === caseArg);
  if (cases.length === 0) {
    throw new Error(`没有匹配的 case（--case=${caseArg}）`);
  }

  const rubric = loadRubric();
  const subjectModel = noLlm ? null : createChatModel({ temperature: 0, streaming: false });
  const judgeModel = noLlm ? null : await resolveJudgeModel(prisma);

  console.log(`▶ 评测数据集 ${DATASET_NAME}：${cases.length} 个 case${noLlm ? '（--no-llm：仅检索指标）' : ''}`);
  console.log(`   rubric v${rubric.version}，topK=${TOP_K}${enableRagas ? '，RAGAS 已启用' : ''}`);

  const started = Date.now();
  const results: CaseResult[] = [];
  const search = new SearchService(prisma as any, new EmbeddingService());

  for (const c of cases) {
    try {
      const r = await runOneCase(c, search, subjectModel, judgeModel);
      const flag = r.judgePassed === false ? ' ⚠️ judge-fail' : '';
      console.log(`  ✓ ${pad(c.id, 20)} ${JSON.stringify(r.metrics)}${flag}`);
      results.push(r);
    } catch (err) {
      // 单 case 失败不中断整轮：空 metrics 不参与均值，但会把整轮判为 fail
      const reason = (err as Error).message ?? String(err);
      console.log(`  ✗ ${pad(c.id, 20)} ${reason}`);
      results.push({ id: c.id, tags: c.tags, metrics: {}, error: reason });
    }
  }

  // 聚合 + 报告
  const summary = aggregate(results);
  const jsonPath = writeReport(summary, results);
  printTable(summary);

  const passed = gateDecision(summary, DEFAULT_GATE);
  const reasons = describeGateFailures(summary, DEFAULT_GATE);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // 落库：每一次跑留一份带上下文的快照
  let persisted = false;
  try {
    await prisma.evalRun.create({
      data: {
        datasetName: DATASET_NAME,
        gitSha: gitSha(),
        judgeModel: judgeModel?.name ?? 'none(--no-llm)',
        rubricVersion: rubric.version,
        noLlm,
        totalCases: results.length,
        failedCases: summary.failedCases,
        passed,
        gateReasons: reasons,
        avgRecall: summary.overall.recall ?? null,
        avgPrecision: summary.overall.precision ?? null,
        avgNdcg: summary.overall.ndcg ?? null,
        avgMrr: summary.overall.mrr ?? null,
        avgJudgeScore: summary.overall.judgeScore ?? null,
        avgIntentCorrect: summary.overall.intentCorrect ?? null,
        avgFaithfulness: summary.overall.faithfulness ?? null,
        // Prisma 的 Json 字段要求 InputJsonValue（不接受 undefined），
        // 这里先走一轮 JSON 序列化把 CaseResult 里的可选/undefined 归一化掉，
        // 顺带确保存进去的就是报告文件里那份结构的真子集
        report: JSON.parse(JSON.stringify({ summary, results })),
      },
    });
    persisted = true;
  } catch (err) {
    // eval_runs 没建表不该拦住本地评测：CI 里表一定存在，届时插入失败会直接暴露出来
    console.warn(`⚠️  写入 eval_runs 失败（表可能尚未迁移）：${(err as Error).message}`);
    console.warn('   跑 NODE_OPTIONS= pnpm db:push 后再试；本次结果仍以本地报告为准。');
  }

  await prisma.$disconnect();
  await pool.end();

  console.log(`\n📄 报告已写入 ${jsonPath}（及同名 .csv）  ⏱ ${elapsed}s${persisted ? '，已落 eval_runs' : ''}`);

  if (passed) {
    console.log('✅ EVAL PASSED');
  } else {
    console.log(
      `❌ EVAL FAILED（recall>=${DEFAULT_GATE.minRecall} / judge>=${DEFAULT_GATE.minJudgeScore} / intent>=${DEFAULT_GATE.minIntentCorrect}）`,
    );
    for (const reason of reasons) console.log(`   - ${reason}`);
  }

  process.exit(passed ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('❌ 评测失败：', err);
  process.exit(1);
});
