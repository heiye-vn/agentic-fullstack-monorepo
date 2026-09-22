/**
 * scripts/sync-langsmith-dataset.ts
 *
 * 把本地 golden 数据集（src/eval/datasets/*.jsonl）**幂等**地同步到 LangSmith Dataset。
 *
 * 幂等是这里的第一要求：autix 那版每次都无条件 createExamples，跑几遍就攒几份重复
 * example，实验对比时同一条 case 出现两次，分数还不一样，非常难查。
 * 本实现以 case.id 为准做 upsert：
 *   1. 先 listExamples 拿到已有集合，用 metadata.caseId 建索引
 *   2. 已存在 → updateExample；不存在 → 攒起来批量 createExamples
 *
 * ⚠️ 用的是 `createExamples(uploads: ExampleCreate[])` 这个重载 ——
 * langsmith 里 `createExamples({inputs, outputs, metadata, datasetId})` 那个签名
 * 已被标记 @deprecated。
 *
 * 前置：注册 https://smith.langchain.com 拿到 API key，写进 .env 的 LANGSMITH_API_KEY
 * 运行（Windows 下 pnpm 需要 NODE_OPTIONS= 前缀）：
 *   cd services/chat && NODE_OPTIONS= pnpm exec tsx scripts/sync-langsmith-dataset.ts
 */
import 'dotenv/config';
import { Client } from 'langsmith';
import type { Example, ExampleCreate } from 'langsmith/schemas';
import { loadDataset } from '../src/eval/dataset-loader.js';

const DATASET_NAME = 'autix-requirement-analysis';

async function main() {
  if (!process.env.LANGSMITH_API_KEY) {
    console.error('❌ 缺少 LANGSMITH_API_KEY，请先在 .env 中配置');
    console.error('   注册地址：https://smith.langchain.com');
    process.exit(1);
  }

  const client = new Client();
  const cases = loadDataset('requirement-analysis');

  // 1) Dataset：存在则复用，不存在则创建
  let datasetId: string;
  try {
    const existing = await client.readDataset({ datasetName: DATASET_NAME });
    datasetId = existing.id;
    console.log(`📦 Dataset "${DATASET_NAME}" 已存在 (id=${datasetId})`);
  } catch {
    const created = await client.createDataset(DATASET_NAME, {
      description: '需求分析 golden 数据集（第十七章；从 src/eval/datasets 同步而来，勿在线上改）',
    });
    datasetId = created.id;
    console.log(`📦 Dataset "${DATASET_NAME}" 已创建 (id=${datasetId})`);
  }

  // 2) 拉取已有 example，按 metadata.caseId 建索引
  //    listExamples 返回的是惰性分页的 AsyncIterable（不是数组），
  //    直接当数组用会得到「没有 Symbol.iterator」的报错 —— 必须先收集
  const existing: Example[] = [];
  for await (const ex of client.listExamples({ datasetId })) {
    existing.push(ex);
  }
  const byCaseId = new Map<string, string>();
  for (const ex of existing) {
    const caseId = (ex.metadata as Record<string, unknown> | undefined)?.caseId;
    if (typeof caseId === 'string') byCaseId.set(caseId, ex.id);
  }
  console.log(`   远端现有 ${existing.length} 个 example，按 caseId 索引到 ${byCaseId.size} 条`);

  // 3) 逐条 upsert
  const creates: ExampleCreate[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const c of cases) {
    const inputs = { input: c.input };
    const outputs = {
      expectedIntent: c.expectedIntent,
      relevantChunkIds: c.relevantChunkIds ?? [],
      groundTruthAnswer: c.groundTruthAnswer ?? null,
    };
    const metadata = { caseId: c.id, tags: c.tags, source: 'local-jsonl' };

    const remoteId = byCaseId.get(c.id);
    if (remoteId) {
      // 简单去重：输入完全一致就不发更新请求，避免每次同步都刷 modified_at
      const remote = existing.find((e) => e.id === remoteId);
      const same =
        remote &&
        (remote.inputs as Record<string, unknown> | undefined)?.input === c.input &&
        (remote.outputs as Record<string, unknown> | undefined)?.expectedIntent === c.expectedIntent;
      if (same) {
        unchanged += 1;
        continue;
      }
      await client.updateExample({ id: remoteId, inputs, outputs, metadata });
      updated += 1;
    } else {
      creates.push({ inputs, outputs, metadata, dataset_id: datasetId });
    }
  }

  if (creates.length > 0) {
    await client.createExamples(creates);
  }

  console.log(
    `✅ 同步完成：新增 ${creates.length} / 更新 ${updated} / 未变 ${unchanged}（共 ${cases.length} 条）`,
  );
  console.log(`   查看：https://smith.langchain.com → Datasets → ${DATASET_NAME}`);
  console.log('   💡 再跑一次应该全部落在「未变」，如果又出现新增说明 caseId 索引没生效。');
}

main().catch((err: unknown) => {
  console.error('❌ 同步失败：', (err as Error).message ?? err);
  process.exit(1);
});
