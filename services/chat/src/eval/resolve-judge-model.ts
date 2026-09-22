/**
 * services/chat/src/eval/resolve-judge-model.ts
 *
 * judge 模型的统一解析（第十七章 17.5.3）
 *
 * 抽出来是因为有两个消费方：本地 runner（scripts/run-eval.ts）和
 * LangSmith Experiment（scripts/run-langsmith-eval.ts）。两边各自实现一遍，
 * 迟早会出现「本地用强模型打的分、托管平台用默认模型打的分」这种对不齐。
 *
 * 核心约束：**judge 不能是被测链路那个模型实例**。
 * 让模型给自己的输出打分会系统性偏高（self-enhancement bias），
 * 回归评测就退化成「自己跟自己比」，看不出真实退化。
 */
import { createChatModel } from '../llm/model.factory.js';
import { DEFAULT_AGENT_MODEL_SET } from '../llm/cost/agent-model-set.js';

/**
 * 最小依赖接口：只需要能按 id 查一条模型配置。
 * 用结构化类型而不是具体 PrismaClient，是为了让脚本和测试都能注入替身。
 */
export interface ModelConfigLookup {
  modelConfig: {
    findUnique(args: {
      where: { id: string };
      select: { model: true; isActive: true };
    }): Promise<{ model: string; isActive: boolean } | null>;
  };
}

export type JudgeModelSource = 'critic-config' | 'env' | 'default';

export interface JudgeModel {
  model: ReturnType<typeof createChatModel>;
  /** 可读的模型标识，写进 eval_runs.judgeModel 和实验 metadata */
  name: string;
  source: JudgeModelSource;
}

/**
 * 取 judge 模型：优先 model_configs 里 critic 那一档（strong），
 * 拿不到再退回 EVAL_JUDGE_MODEL 环境变量，最后是 langchain.yaml 里的默认模型。
 *
 * 两级回落都只是为了让脚本在配置不全时还能跑起来 —— 一旦出现，
 * 日志会明确 warn，避免「悄悄用错模型进行了一轮评测」。
 */
export async function resolveJudgeModel(prisma: ModelConfigLookup): Promise<JudgeModel> {
  const configId = DEFAULT_AGENT_MODEL_SET.criticModelConfigId;

  try {
    const row = await prisma.modelConfig.findUnique({
      where: { id: configId },
      select: { model: true, isActive: true },
    });
    if (row?.isActive) {
      return {
        model: createChatModel({ modelName: row.model, temperature: 0, streaming: false }),
        name: row.model,
        source: 'critic-config',
      };
    }
    console.warn(`⚠️  model_configs 里没有可用的 ${configId}，judge 将回落到其他来源`);
  } catch (err) {
    console.warn(`⚠️  读取模型配置失败（${(err as Error).message}），judge 将回落到其他来源`);
  }

  const fromEnv = process.env.EVAL_JUDGE_MODEL;
  if (fromEnv) {
    console.warn(`⚠️  改用 EVAL_JUDGE_MODEL=${fromEnv} 作为 judge 模型`);
    return {
      model: createChatModel({ modelName: fromEnv, temperature: 0, streaming: false }),
      name: fromEnv,
      source: 'env',
    };
  }

  return {
    model: createChatModel({ temperature: 0, streaming: false }),
    name: 'default(config)',
    source: 'default',
  };
}
