import { BaseMessage, SystemMessage } from '@langchain/core/messages';

export interface SummaryModel {
  invoke(messages: { role: string; content: string }[]): Promise<{ content: string }>;
}

export interface CompressOptions {
  keepRecent?: number;
  summaryMaxTokens?: number;
}

/**
 * 对话历史摘要压缩器
 * - 抽出全部 SystemMessage 单独保留
 * - 非 system 消息数 <= keepRecent 时直接返回原 messages
 * - 否则把早期消息通过 summaryModel 压缩为摘要
 * - 最终返回 [原 system..., 摘要 system, 最近 keepRecent 条]
 */
export async function compressConversation(
  messages: BaseMessage[],
  summaryModel: SummaryModel,
  options: CompressOptions = {},
): Promise<BaseMessage[]> {
  const { keepRecent = 10, summaryMaxTokens = 500 } = options;

  const systemMsgs = messages.filter((m) => m instanceof SystemMessage);
  const nonSystemMsgs = messages.filter((m) => !(m instanceof SystemMessage));

  if (nonSystemMsgs.length <= keepRecent) return messages;

  const earlyMsgs = nonSystemMsgs.slice(0, -keepRecent);
  const recentMsgs = nonSystemMsgs.slice(-keepRecent);

  const conversationText = earlyMsgs.map((m) => `${m._getType()}: ${m.content}`).join('\n');
  const summaryResponse = await summaryModel.invoke([
    {
      role: 'system',
      content: `把以下对话压缩为摘要，保留关键信息（需求编号、功能描述、用户意图、已完成的操作）。最多 ${summaryMaxTokens} 个 token。`,
    },
    { role: 'user', content: conversationText },
  ]);

  const summaryMsg = new SystemMessage(`[对话摘要] ${summaryResponse.content}`);
  return [...systemMsgs, summaryMsg, ...recentMsgs];
}
