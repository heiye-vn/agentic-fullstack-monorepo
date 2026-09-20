/**
 * services/chat/rag/agent/rag-tool.ts
 *
 * 第十一章 11.10 — RAG-as-Tool 集成到 LangGraph Agent
 *
 * 将 RAG Pipeline 封装为标准的 LangChain StructuredTool，并与第十章预算策略协同。
 *
 * ============================================================================
 * 教学示例：如何在第九章 Functional Expert 中接入本工具（伪代码说明，不修改主图源文件）
 * ============================================================================
 * // 在 services/chat/src/llm/graph/experts.ts 中：
 * // import { createRagTool } from '../../rag/agent/rag-tool.js';
 * //
 * // export function buildFunctionalExpertTools(model: BaseChatModel, userId: string) {
 * //   return [
 * //     readRequirementTool,
 * //     checkExistingFeaturesTool,
 * //     // 新增挂载 RAG 工具（自主按需检索业务规范）：
 * //     createRagTool({ model, userId }),
 * //   ];
 * // }
 * ============================================================================
 */

import { tool, StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  ragAsk,
  type RagAskInput,
  type RagAskOutput,
} from '../pipeline/rag-pipeline.js';
import {
  resolveBudgetAction,
  type BudgetPolicyOutput,
} from '../../src/llm/cost/budget-policy.js';

export const RAG_TOOL_NAME = 'search_knowledge_base';

export const RAG_TOOL_DESCRIPTION =
  '根据问题检索企业内部知识库，返回基于知识库的回答和引用来源。' +
  '适用于查询业务规则、产品文档、内部规范、历史决策等需要从知识库找答案的场景。' +
  '不适用于：闲聊、纯计算、时间查询。';

export interface CreateRagToolDeps {
  model: any;
  userId: string;
  searchFn?: (query: string, topK?: number) => Promise<any[]>;
  getBudget?: () => { usedPercent: number };
  ragAskFn?: (input: RagAskInput) => Promise<RagAskOutput>;
  resolveBudgetActionFn?: (input: {
    budgetUsedPercent: number;
    agentName: string;
  }) => BudgetPolicyOutput;
}

/**
 * 创建 RAG LangChain 结构化工具
 *
 * 特性：
 * 1. 预算闸门前置：先于 RAG 耗时操作调用 resolveBudgetAction 检查，若 reject 则快速阻断并返回错误提示
 * 2. 引用按 chunkId 去重：防止同一片段因多路召回出现重复引用
 * 3. 严格遵循 LangChain Tool 契约：输出经过 JSON 序列化的纯字符串
 *
 * @param deps 外部依赖模型、检索器、用户 ID 与预算检查器
 * @returns 包装好的 StructuredTool
 */
export function createRagTool(deps: CreateRagToolDeps): StructuredTool {
  const askFn = deps.ragAskFn ?? ragAsk;
  const budgetFn = deps.resolveBudgetActionFn ?? resolveBudgetAction;

  return tool(
    async ({ question, topK }: { question: string; topK?: number }) => {
      // 1. 预算检查前置（避免在超预算时调用昂贵的向量检索与大模型）
      const budgetUsedPercent = deps.getBudget
        ? deps.getBudget().usedPercent
        : 0;
      const budgetAction = budgetFn({
        budgetUsedPercent,
        agentName: 'rag_tool',
      });

      if (budgetAction.action === 'reject') {
        return JSON.stringify({
          error: 'budget_exceeded',
          message: budgetAction.reason,
        });
      }

      // 2. 执行 RAG 问答
      const result = await askFn({
        question,
        userId: deps.userId,
        topK: topK ?? 5,
        model: deps.model,
        searchFn: deps.searchFn,
      });

      // 3. Citations 去重处理（按 chunkId 去重）
      const seenChunkIds = new Set<string>();
      const dedupedCitations = [];

      for (const c of result.citations || []) {
        if (!seenChunkIds.has(c.chunkId)) {
          seenChunkIds.add(c.chunkId);
          dedupedCitations.push({
            chunkId: c.chunkId,
            documentId: c.documentId,
            score:
              typeof c.score === 'number'
                ? Number(c.score.toFixed(3))
                : c.score,
          });
        }
      }

      // 4. LangChain 工具返回必须是字符串
      return JSON.stringify({
        answer: result.answer,
        citations: dedupedCitations,
      });
    },
    {
      name: RAG_TOOL_NAME,
      description: RAG_TOOL_DESCRIPTION,
      schema: z.object({
        question: z.string().describe('用户的问题，应当是自然语言完整问句'),
        topK: z.number().optional().describe('检索结果数量，默认 5'),
      }),
    },
  );
}
