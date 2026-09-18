import { BaseMessage, SystemMessage } from '@langchain/core/messages';

export interface TrimOptions {
  maxMessages?: number;
  preserveSystemMessages?: boolean;
}

/**
 * 消息滑动窗口裁剪器
 * - 抽出全部 SystemMessage 单独保留
 * - 对剩余消息 slice(-maxMessages)
 * - 调用 removeOrphanToolMessages 清理孤立工具消息与缺失调用的 AIMessage
 * - 拼回 [system..., 清理后消息]
 */
export function trimMessagesForContext(
  messages: BaseMessage[],
  options: TrimOptions = {},
): BaseMessage[] {
  const { maxMessages = 20, preserveSystemMessages = true } = options;

  const systemMsgs = preserveSystemMessages
    ? messages.filter((m) => m instanceof SystemMessage)
    : [];
  const nonSystemMsgs = messages.filter((m) => !(m instanceof SystemMessage));

  const trimmed = nonSystemMsgs.slice(-maxMessages);
  const cleaned = removeOrphanToolMessages(trimmed);
  return [...systemMsgs, ...cleaned];
}

/**
 * 按 tool_call_id 精确配对，避免 OpenAI/Anthropic 因 tool_calls 不完整报错。
 * 策略是"全有或全无"：
 *   - AIMessage(tool_calls) 必须每一个 tool_call.id 都能在窗口内找到对应的
 *     ToolMessage(tool_call_id)，否则整条 AIMessage 移除。
 *   - ToolMessage 仅当 tool_call_id 出现在某条幸存的 AIMessage 的 tool_calls 中
 *     时才保留。
 */
function removeOrphanToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const respondedToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg._getType() === 'tool') {
      const tcId = (msg as any).tool_call_id as string | undefined;
      if (tcId) respondedToolCallIds.add(tcId);
    }
  }

  const survivingAiIndices = new Set<number>();
  const survivingToolCallIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg._getType() !== 'ai') continue;
    const toolCalls = (msg as any).tool_calls as Array<{ id?: string }> | undefined;
    if (!toolCalls || toolCalls.length === 0) continue;

    const allResponded = toolCalls.every(
      (tc) => tc.id && respondedToolCallIds.has(tc.id),
    );
    if (allResponded) {
      survivingAiIndices.add(i);
      for (const tc of toolCalls) if (tc.id) survivingToolCallIds.add(tc.id);
    }
  }

  const result: BaseMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgType = msg._getType();

    if (msgType === 'ai') {
      const toolCalls = (msg as any).tool_calls as Array<{ id?: string }> | undefined;
      if (toolCalls && toolCalls.length > 0) {
        if (survivingAiIndices.has(i)) result.push(msg);
        continue;
      }
    }

    if (msgType === 'tool') {
      const tcId = (msg as any).tool_call_id as string | undefined;
      if (tcId && survivingToolCallIds.has(tcId)) result.push(msg);
      continue;
    }

    result.push(msg);
  }
  return result;
}
