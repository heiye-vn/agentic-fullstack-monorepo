/**
 * scripts/setup-eval-db.ts
 *
 * 幂等创建第十七章评测所需的 `eval_runs` 表（只增不删）。
 *
 * 为什么不用 `prisma db push` / `migrate dev`：
 * 本项目的库 historically 是 `db push` 直接建的，`_prisma_migrations` 并不完整，
 * 一跑 `migrate dev` 就可能要求 reset（会丢数据）。而 `db push` 是双向同步，
 * 遇到 drift 会试图让库跟 schema 完全一致，同样有不可预期的写入。
 *
 * 评测只需要多一张表，最稳的做法就是「只做增量的 DDL」，
 * 全用 IF NOT EXISTS —— 重复跑多少次都不会动到既有数据。
 *
 * 运行（Windows 下 pnpm 需要 NODE_OPTIONS= 前缀）：
 *   cd services/chat && NODE_OPTIONS= pnpm exec tsx scripts/setup-eval-db.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres123@localhost:5432/autix_chat?schema=public';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id"               TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "datasetName"      VARCHAR(100) NOT NULL,
  "gitSha"           VARCHAR(64),
  "judgeModel"       VARCHAR(100) NOT NULL,
  "rubricVersion"    INTEGER,
  "noLlm"            BOOLEAN NOT NULL DEFAULT false,
  "totalCases"       INTEGER NOT NULL,
  "failedCases"      INTEGER NOT NULL DEFAULT 0,
  "passed"           BOOLEAN NOT NULL,
  "gateReasons"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "avgRecall"        DOUBLE PRECISION,
  "avgPrecision"     DOUBLE PRECISION,
  "avgNdcg"          DOUBLE PRECISION,
  "avgMrr"           DOUBLE PRECISION,
  "avgJudgeScore"    DOUBLE PRECISION,
  "avgIntentCorrect" DOUBLE PRECISION,
  "avgFaithfulness"  DOUBLE PRECISION,
  "report"           JSONB NOT NULL,
  CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);
`;

const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS "eval_runs_createdAt_idx" ON "eval_runs"("createdAt");',
  'CREATE INDEX IF NOT EXISTS "eval_runs_datasetName_passed_idx" ON "eval_runs"("datasetName", "passed");',
];

/** Prisma schema（EvalRun）里声明的字段，用于建完后自检对不对得上 */
const EXPECTED_COLUMNS = [
  'id', 'createdAt', 'datasetName', 'gitSha', 'judgeModel', 'rubricVersion',
  'noLlm', 'totalCases', 'failedCases', 'passed', 'gateReasons',
  'avgRecall', 'avgPrecision', 'avgNdcg', 'avgMrr',
  'avgJudgeScore', 'avgIntentCorrect', 'avgFaithfulness', 'report',
];

async function main() {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(CREATE_TABLE);
    for (const idx of CREATE_INDEXES) await pool.query(idx);
    console.log('✅ eval_runs 表就绪（IF NOT EXISTS，重复执行无副作用）');

    // 自检：表里必须包含 Prisma schema 声明的全部字段，否则 run-eval 写库会炸
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'eval_runs'`,
    );
    const existing = new Set(rows.map((r) => r.column_name));
    const missing = EXPECTED_COLUMNS.filter((c) => !existing.has(c));

    if (missing.length > 0) {
      console.warn(`⚠️  缺列：${missing.join(', ')}`);
      console.warn('   表里可能是旧结构的残留，确认无误后手工补列再重跑。');
      process.exit(1);
    }
    console.log(`   字段自检通过：${EXPECTED_COLUMNS.length}/${EXPECTED_COLUMNS.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('❌ 建表失败：', err);
  process.exit(1);
});
