"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type {
  AIUIResponse,
  ChatMessage,
  UIAction,
  UIResponseContext,
} from "@/types/ui-protocol";
import { ComponentRenderer } from "./ComponentRenderer";

const QUICK_SUGGESTIONS = [
  "我要提一个新需求：用户希望能够批量导入 Excel 数据",
  "提新需求：系统需要支持飞书扫码登录与权限同步",
  "查看当前需求分析处理进度",
];

function generateNewSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

function createMsgId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function getNowTimestamp(): number {
  return Date.now();
}

function parseApiResponse(json: unknown): AIUIResponse {
  if (json && typeof json === "object") {
    // 兼容 NestJS 全局拦截器包装: { code: '200', data: { message, components, context } }
    if ("data" in json && json.data && typeof json.data === "object") {
      const nested = json.data as Record<string, unknown>;
      if ("message" in nested || "components" in nested) {
        return nested as unknown as AIUIResponse;
      }
    }
    // 兼容直接返回 AIUIResponse
    if ("message" in json || "components" in json) {
      return json as unknown as AIUIResponse;
    }
  }
  return {
    message: typeof json === "string" ? json : "收到响应，但格式不符",
    components: [],
  };
}

export const AIChatContainer: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [context, setContext] = useState<UIResponseContext | undefined>(undefined);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_CHAT_API_URL || "http://localhost:4001";

  // 客户端挂载后初始化会话 ID
  useEffect(() => {
    let currentId = sessionStorage.getItem("autix_ai_ui_session_id");
    if (!currentId) {
      currentId = generateNewSessionId();
      sessionStorage.setItem("autix_ai_ui_session_id", currentId);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(currentId);
  }, []);

  // 消息更新后平滑滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // 重置会话
  const handleResetSession = useCallback(() => {
    const newId = generateNewSessionId();
    sessionStorage.setItem("autix_ai_ui_session_id", newId);
    setSessionId(newId);
    setMessages([]);
    setContext(undefined);
    setError(null);
  }, []);

  // 1. 发送文本对话 -> POST /api/ui-chat/chat
  const handleSendText = async (textToSend?: string) => {
    const raw = textToSend !== undefined ? textToSend : input;
    const trimmed = raw.trim();
    if (!trimmed || loading || !sessionId) return;

    setError(null);
    setInput("");

    // 将用户消息加入聊天流
    const now = getNowTimestamp();
    const userMsg: ChatMessage = {
      id: createMsgId("user"),
      role: "user",
      content: trimmed,
      timestamp: now,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(`${apiBaseUrl}/api/ui-chat/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          input: trimmed,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`服务响应异常 (${res.status}): ${errText || res.statusText}`);
      }

      const resJson = (await res.json()) as unknown;
      const data = parseApiResponse(resJson);

      // 记录助手消息与 UI 组件
      const assistantMsg: ChatMessage = {
        id: createMsgId("assistant"),
        role: "assistant",
        content: data.message,
        components: data.components || [],
        context: data.context,
        timestamp: getNowTimestamp(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      if (data.context) {
        setContext(data.context);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 2. 响应组件交互 -> POST /api/ui-chat/action
  const handleUIAction = async (action: UIAction) => {
    if (loading || !sessionId) return;

    setError(null);
    setLoading(true);

    // 格式化当前执行的操作提示，反馈到消息流中展示
    let actionDesc = "执行操作";
    if (action.payload && typeof action.payload === "object" && "type" in action.payload) {
      const p = action.payload as { type: string; selectedValue?: unknown; selectedId?: unknown; formData?: Record<string, unknown>; confirmed?: boolean; actionId?: string };
      if (p.type === "select") {
        actionDesc = `选择选项: ${JSON.stringify(p.selectedValue || p.selectedId)}`;
      } else if (p.type === "submit") {
        actionDesc = `提交表单数据 (${Object.keys(p.formData || {}).length}项)`;
      } else if (p.type === "confirm") {
        actionDesc = p.confirmed ? "确认执行操作" : "取消操作";
      } else if (p.type === "click") {
        actionDesc = `点击按钮: ${action.actionKey || p.actionId || "操作"}`;
      }
    }

    const actionFeedbackMsg: ChatMessage = {
      id: createMsgId("action"),
      role: "user",
      content: `[用户操作] ${actionDesc}`,
      timestamp: getNowTimestamp(),
      isActionFeedback: true,
    };
    setMessages((prev) => [...prev, actionFeedbackMsg]);

    try {
      const res = await fetch(`${apiBaseUrl}/api/ui-chat/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          action,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`操作处理异常 (${res.status}): ${errText || res.statusText}`);
      }

      const resJson = (await res.json()) as unknown;
      const data = parseApiResponse(resJson);

      const assistantMsg: ChatMessage = {
        id: createMsgId("assistant"),
        role: "assistant",
        content: data.message,
        components: data.components || [],
        context: data.context,
        timestamp: getNowTimestamp(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      if (data.context) {
        setContext(data.context);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto rounded-2xl border border-neutral-800 bg-neutral-950/70 shadow-2xl overflow-hidden backdrop-blur-xl">
      {/* 会话顶部控制条 */}
      <div className="flex items-center justify-between border-b border-neutral-800/80 px-4 py-3 bg-neutral-900/40">
        <div className="flex items-center gap-2.5">
          <div className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <span className="text-xs font-mono text-neutral-400">
            会话 ID: <span className="text-neutral-200">{sessionId.slice(0, 16)}...</span>
          </span>
          {context?.sessionStage && (
            <span className="ml-2 inline-flex items-center rounded-full bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
              阶段: {context.sessionStage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetSession}
            title="清空当前消息并生成新会话"
            className="flex items-center gap-1 rounded-md border border-neutral-700/60 bg-neutral-800/70 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-neutral-700 hover:text-white cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            新会话
          </button>
        </div>
      </div>

      {/* 消息滚动流 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-3 shadow-inner">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-neutral-200">
              AI 需求分析协议式交互平台
            </h3>
            <p className="mt-1 text-xs text-neutral-400 max-w-md leading-relaxed">
              基于后端 LangChain Structured Output 与确定性状态机，自动流转选型卡片、表单录入、确认弹窗与结构化报告。
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-lg">
              {QUICK_SUGGESTIONS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendText(item)}
                  className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                >
                  💬 {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
            >
              {!isUser && (
                <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xs shadow-md">
                  AI
                </div>
              )}

              <div
                className={`max-w-[88%] sm:max-w-[80%] flex flex-col space-y-3 ${
                  isUser ? "items-end" : "items-start"
                }`}
              >
                {/* 气泡文字部分 */}
                {msg.content && (
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                      isUser
                        ? msg.isActionFeedback
                          ? "bg-neutral-800/80 border border-neutral-700/60 text-neutral-300"
                          : "bg-indigo-600 text-white shadow-sm"
                        : "bg-neutral-900/90 border border-neutral-800 text-neutral-100"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                )}

                {/* 助手返回的 UI 组件列表 */}
                {!isUser && msg.components && msg.components.length > 0 && (
                  <div className="w-full space-y-3.5 pt-1">
                    {msg.components.map((comp, cIdx) => (
                      <ComponentRenderer
                        key={cIdx}
                        component={comp}
                        onAction={handleUIAction}
                        disabled={loading}
                      />
                    ))}
                  </div>
                )}
              </div>

              {isUser && (
                <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-300 font-medium text-xs">
                  ME
                </div>
              )}
            </div>
          );
        })}

        {/* 思考中骨架等待 */}
        {loading && (
          <div className="flex gap-3 justify-start items-center text-xs text-neutral-400">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-950/60 border border-indigo-500/30 text-indigo-400">
              <span className="inline-block animate-spin">⏳</span>
            </div>
            <div className="flex items-center gap-1.5 bg-neutral-900/70 border border-neutral-800 rounded-xl px-3 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
              <span className="ml-1 text-[11px] text-neutral-400">
                AI 正在推理结构化协议中...
              </span>
            </div>
          </div>
        )}

        {/* 错误警告 */}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-neutral-400 hover:text-white text-xs px-2 py-0.5 rounded cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入控制区 */}
      <div className="border-t border-neutral-800/80 bg-neutral-900/60 p-3 sm:p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendText();
          }}
          className="relative flex items-end gap-2"
        >
          <textarea
            value={input}
            rows={1}
            disabled={loading}
            placeholder="输入自然语言需求，例如：'提新需求：支持单点登录' (Enter 发送, Shift+Enter 换行)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 max-h-32 min-h-[44px] rounded-xl border border-neutral-800 bg-neutral-950/90 px-3.5 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-indigo-500/80 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none custom-scrollbar disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-xs font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm shadow-indigo-600/30"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
};
