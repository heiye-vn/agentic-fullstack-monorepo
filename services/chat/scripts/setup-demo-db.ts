/**
 * setup-demo-db.ts
 *
 * 第十章 Demo 数据库初始化脚本。
 *
 * 与教程第十章一致，本章使用独立的 demo 库，避免污染主库：
 *   1. 在 services/chat/.env 里把 DATABASE_URL 指向 autix_chat_demo
 *   2. 建库（首次）：createdb autix_chat_demo
 *   3. 跑迁移：NODE_OPTIONS= pnpm exec prisma migrate deploy
 *   4. 播种：NODE_OPTIONS= pnpm db:seed-demo
 *
 * 播种内容只有一项：`model_configs` 里的三档模型配置。
 * 目的是让 `DEFAULT_AGENT_MODEL_SET`（10.7 模型分级）引用的 modelConfigId 不再悬空——
 * 之前那句"按角色查表返回 demo-gpt-4o"查到的其实是一张空表。
 *
 * ⚠️ 模型标识按本项目实际在用的阿里云百炼（dashscope）填写；若账号未开通某个模型，
 * 用环境变量覆盖成自己可用的模型标识即可（见下方 DEMO_MODEL_* 说明）。
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { DEFAULT_AGENT_MODEL_SET } from '../src/llm/cost/agent-model-set.js';
import { getModelPricing } from '../src/llm/cost/token-estimator.js';

/**
 * 三档模型配置。id 必须与 DEFAULT_AGENT_MODEL_SET 里的 modelConfigId 完全一致。
 * 用「档位」而不是模型名做 ID：模型换供应商时只动 model 字段，常量不用改。
 * 可用环境变量覆盖模型标识：
 *   DEMO_MODEL_STRONG / DEMO_MODEL_MEDIUM / DEMO_MODEL_WEAK
 */
const MODEL_SEEDS = [
  {
    id: 'demo-model-strong',
    name: '百炼-Qwen3.8-Max（强模型档）',
    model: process.env.DEMO_MODEL_STRONG || 'qwen3.8-max',
    priority: 10,
    isDefault: false,
    tier: 'strong',
    usage: 'supervisor / security / compliance / summary / critic',
  },
  {
    id: 'demo-model-medium',
    name: '百炼-DeepSeek-V4-Flash（中档）',
    model: process.env.DEMO_MODEL_MEDIUM || 'deepseek-v4-flash',
    priority: 5,
    isDefault: true,
    tier: 'medium',
    usage: 'functional / performance / risk',
  },
  {
    id: 'demo-model-weak',
    name: '百炼-Qwen3.7-Flash（经济档）',
    model: process.env.DEMO_MODEL_WEAK || 'qwen3.7-flash-2026-07-15',
    priority: 1,
    isDefault: false,
    tier: 'weak',
    usage: 'compressor（摘要压缩）',
  },
] as const;

/**
 * 校验"档位越靠后越便宜"这条不变量：降级策略的前提就是降级真能省钱。
 * 百炼各模型单价并不按参数量单调（例如 deepseek-v4-flash 比 qwen3.7-flash 贵 7 倍），
 * 拍脑袋分配档位很容易把"降级"写成"涨价"。
 */
function checkTierPriceOrdering() {
  const unitCost = (model: string) => {
    const p = getModelPricing(model);
    // 以 1:1 的输入/输出混合口径比较单价量级
    return p.input + p.output;
  };

  console.log('\n💡 档位单价校验（PRICING 表口径，input+output /1M）：');
  const rows = MODEL_SEEDS.map((s) => ({
    tier: s.tier,
    model: s.model,
    unit: unitCost(s.model),
  }));
  for (const r of rows) {
    console.log(`   ${r.tier.padEnd(7)} ${r.model.padEnd(24)} $${r.unit.toFixed(3)}`);
  }

  const strong = rows.find((r) => r.tier === 'strong')!.unit;
  const medium = rows.find((r) => r.tier === 'medium')!.unit;
  const weak = rows.find((r) => r.tier === 'weak')!.unit;

  if (strong > medium && medium > weak) {
    console.log(`   ✅ 档位单调递减，强/弱倍率 ${(strong / weak).toFixed(1)}x`);
    return;
  }

  console.warn('   ⚠️ 档位单价不是递减的 —— 降级可能反而更贵，请调整档位映射：');
  if (strong <= medium) console.warn('      · strong 不比 medium 贵：strong/medium 需要换档');
  if (medium <= weak) console.warn('      · medium 不比 weak 贵：medium/weak 需要换档');
  console.warn('    （也可能是新模型不在 PRICING 表里，回退到了 gpt-4o-mini 默认价）');
}

function assertDemoDatabase(databaseUrl: string): string {
  const dbName = databaseUrl.split('?')[0].split('/').pop() || '';
  if (!dbName.includes('demo') && process.env.ALLOW_NON_DEMO_DB !== '1') {
    console.error(`\n❌ 拒绝执行：当前 DATABASE_URL 指向 "${dbName}"，不像 demo 库。`);
    console.error('   本脚本会 upsert model_configs，误跑在业务库上会产生脏数据。');
    console.error('   确认要跑就给命令加上 ALLOW_NON_DEMO_DB=1。\n');
    process.exit(1);
  }
  return dbName;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ 未找到 DATABASE_URL，请检查 services/chat/.env');
    process.exit(1);
  }

  const dbName = assertDemoDatabase(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log('🔧 第十章 Demo 数据库初始化...');
  console.log(`   目标库: ${dbName}`);

  // 先校验档位单价，再落库（映射错了就不该写进库里）
  checkTierPriceOrdering();

  console.log('');
  try {
    await prisma.$connect();
    console.log('✅ 数据库连接成功');

    // 1. 播种三档模型配置
    for (const cfg of MODEL_SEEDS) {
      await prisma.modelConfig.upsert({
        where: { id: cfg.id },
        update: {
          name: cfg.name,
          model: cfg.model,
          provider: 'dashscope',
          priority: cfg.priority,
          isDefault: cfg.isDefault,
          isActive: true,
          visibility: 'public',
        },
        create: {
          id: cfg.id,
          name: cfg.name,
          model: cfg.model,
          provider: 'dashscope',
          type: 'general',
          priority: cfg.priority,
          isDefault: cfg.isDefault,
          isActive: true,
          // public：按「方案 C」，public 模型忽略库内 apiKey，一律走 process.env.OPENAI_API_KEY，
          // 所以这里不写密钥，避免 demo 库里出现明文/密文密钥。
          visibility: 'public',
          capabilities: ['text'],
        },
      });
      console.log(`  ✅ ${cfg.id.padEnd(24)} → ${cfg.model}  [${cfg.tier}] ${cfg.usage}`);
    }

    // 2. 自检：确认 DEFAULT_AGENT_MODEL_SET 引用的 modelConfigId 全部落地
    const referencedIds = Array.from(new Set(Object.values(DEFAULT_AGENT_MODEL_SET)));
    const existing = await prisma.modelConfig.findMany({
      where: { id: { in: referencedIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((r) => r.id));
    const dangling = referencedIds.filter((id) => !existingIds.has(id));

    console.log('\n🔎 DEFAULT_AGENT_MODEL_SET 引用自检：');
    console.log(`   引用 ${referencedIds.length} 个 modelConfigId，命中 ${existingIds.size} 个`);
    if (dangling.length > 0) {
      console.warn(`   ⚠️ 悬空引用：${dangling.join(', ')}`);
      console.warn('   → 检查 agent-model-set.ts 与 MODEL_SEEDS 是否一致');
    } else {
      console.log('   ✅ 无悬空引用，模型分级查表可正常解析');
    }

    console.log('\n🎉 Demo 数据库初始化完成！');
    console.log('   提示：若调用时报 404/model not found，说明该账号未开通对应模型，');
    console.log('        用 DEMO_MODEL_STRONG / DEMO_MODEL_MEDIUM / DEMO_MODEL_WEAK 覆盖即可。');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ 初始化失败：', e);
  process.exit(1);
});
