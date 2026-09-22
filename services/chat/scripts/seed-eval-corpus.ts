/**
 * scripts/seed-eval-corpus.ts
 *
 * 给检索评测灌入 golden 语料（第十七章 17.3 / 17.6）
 *
 * 为什么必须 seed：document_chunks.id 默认是 cuid，每次灌库都变，
 * 而数据集里的 relevantChunkIds（c-auth-1 之类）是写死的 stable id。
 * 这里 seed 时**显式指定 chunk id**，让 ground truth 与库中真实 id 对齐 ——
 * 检索走的仍是真 embedding + 真 pgvector 余弦，指标是真实的，只是 id 可读了。
 *
 * 幂等：每次先清掉 EVAL_USER_ID 名下旧文档（chunks 级联删），再重新灌。
 *
 * 运行（Windows 下 pnpm 需要 NODE_OPTIONS= 前缀）：
 *   cd services/chat
 *   NODE_OPTIONS= pnpm exec tsx scripts/seed-eval-corpus.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { EmbeddingService } from '../src/document/embedding.service.js';
import {
  loadCorpus,
  loadDataset,
  EVAL_USER_ID,
  validateGroundTruth,
} from '../src/eval/dataset-loader.js';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres123@localhost:5432/autix_chat?schema=public';

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const corpus = loadCorpus('requirement-kb');
  const cases = loadDataset('requirement-analysis');

  // 灌库前先验脏：ground truth 指向不存在的 chunk 会让检索指标静默归零，
  // 排查成本远高于在这里拦一道。
  const problems = validateGroundTruth(cases, corpus);
  if (problems.length > 0) {
    throw new Error(
      `数据集与语料对不上，先修数据集再 seed：\n  - ${problems.join('\n  - ')}`,
    );
  }

  console.log(`📚 语料 ${corpus.length} 个 chunk / 数据集 ${cases.length} 条 case，开始灌库`);
  console.log(`   隔离 userId = ${EVAL_USER_ID}`);

  const embedding = new EmbeddingService();

  try {
    // 1) 幂等清理：删旧文档，chunks 由 schema 的 Cascade 级联删除
    const del = await prisma.document.deleteMany({ where: { userId: EVAL_USER_ID } });
    console.log(`🧹 清理旧文档 ${del.count} 篇`);

    // 2) 按 documentId 分组建 documents
    const byDoc = new Map<string, typeof corpus>();
    for (const c of corpus) {
      const list = byDoc.get(c.documentId);
      if (list) list.push(c);
      else byDoc.set(c.documentId, [c]);
    }

    for (const [docId, docChunks] of byDoc) {
      await prisma.document.create({
        data: {
          id: docId,
          userId: EVAL_USER_ID,
          filename: docChunks[0].documentName,
          mimeType: 'text/markdown',
          size: docChunks.reduce((s, c) => s + c.content.length, 0),
          status: 'ready',
          chunkCount: docChunks.length,
          storageType: 'local',
        },
      });
      console.log(`   📄 ${docId.padEnd(10)} ${docChunks[0].documentName}（${docChunks.length} chunk）`);
    }

    // 3) 逐 chunk 真 embedding + 显式 id 插入
    //    embedding 列是 Unsupported("vector")，Prisma 的类型系统写不了，
    //    只能走 raw SQL；这里用 $executeRawUnsafe 的参数位（$1..$6）传值，
    //    向量字面量作为 $5 参数并在 SQL 里 ::vector 强转，避免字符串拼接注入。
    const modelName = embedding.getModelName();
    let index = 0;
    let dim = 0;
    for (const c of corpus) {
      const [vector] = await embedding.embedTexts([c.content]);
      if (!vector || vector.length === 0) {
        throw new Error(`embedding 失败：${c.chunkId}（检查 @xenova/transformers 模型能否下载）`);
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO document_chunks (id, "documentId", content, "chunkIndex", embedding, "modelName")
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        c.chunkId,
        c.documentId,
        c.content,
        index,
        `[${vector.join(',')}]`,
        modelName,
      );
      index += 1;
      dim = vector.length;
    }

    console.log(
      `\n✅ 灌库完成：${byDoc.size} 篇文档 / ${corpus.length} 个 chunk（${dim} 维向量，model=${modelName}）`,
    );
    console.log('   下一步：NODE_OPTIONS= pnpm exec tsx scripts/run-eval.ts --no-llm');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('❌ 灌库失败：', err);
  process.exit(1);
});
