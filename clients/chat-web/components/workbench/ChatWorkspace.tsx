"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { ModelConfig } from "./types";
import type {
  AIUIResponse,
  StepItem,
  UIAction,
  UIComponent,
  UIResponseContext,
} from "@/types/ui-protocol";
import { ComponentRenderer } from "../ai-ui/ComponentRenderer";
import {
  ThinkingIndicator,
  type ProgressInfo,
} from "../ai-ui/ThinkingIndicator";
import { streamGraphAnalysis } from "@/lib/stream-client";
import {
  getStoredSessionMessages,
  saveStoredSessionMessages,
} from "./storage";


interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  components?: UIComponent[];
  context?: UIResponseContext;
  timestamp: string;
  isActionFeedback?: boolean;
}

interface ChatWorkspaceProps {
  sessionId: string;
  models: ModelConfig[];
  currentModel: ModelConfig | null;
  onSelectModel: (model: ModelConfig) => void;
  onUpdateSessionTitle?: (sessionId: string, newTitle: string) => void;
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

const DEFAULT_GREETING =
  "您好！我是 Autix AI 需求分析助理。请描述您的需求，我来帮您进行结构化分析与整理。";

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  sessionId,
  models,
  currentModel,
  onSelectModel,
  onUpdateSessionTitle,
}) => {
  // 使用惰性初始化器同步读取本地历史消息，避免在 useEffect 中同步 setState 引发级联渲染
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    getStoredSessionMessages<ChatMessage>(sessionId)
  );

  // 防御性设计：若外部没有通过 key 重挂载且 sessionId 发生变更，在 render 阶段直接同步状态
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setMessages(getStoredSessionMessages<ChatMessage>(sessionId));
  }

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [deepSearchEnabled, setDeepSearchEnabled] = useState(true);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<UIResponseContext | undefined>(undefined);

  // 9.6.3 前端流式多智能体与并行专家集群状态
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<ProgressInfo | null>(null);
  const [parallelAgents, setParallelAgents] = useState<Record<string, ProgressInfo>>({});
  const [streamingText, setStreamingText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4001";

  // 组件卸载时中止活跃流式请求
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // 保持消息与流式滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, isStreaming, streamingText]);

  // 保存消息至当前会话缓存
  const updateMessages = useCallback(
    (newMessages: ChatMessage[]) => {
      setMessages(newMessages);
      saveStoredSessionMessages(sessionId, newMessages);
    },
    [sessionId]
  );

  // 9.6.3 处理 LangGraph 细粒度流式分析（调用 /api/graph/stream）
  const handleStreamGraph = async (trimmed: string, userMsg: ChatMessage) => {
    setIsStreaming(true);
    setLoading(true);
    setCurrentProgress({
      agent: "triage",
      agentDisplayName: "需求分诊",
      step: 1,
      totalSteps: 6,
      status: "started",
    });
    setParallelAgents({});
    setStreamingText("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedTokens = "";
    const recordedParallelAgents: Record<string, ProgressInfo> = {};

    try {
      await streamGraphAnalysis({
        apiBaseUrl,
        input: trimmed,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "node_start" || event.type === "node_end") {
            const info: ProgressInfo = {
              agent: event.node || "unknown",
              agentDisplayName: event.displayName || event.node || "处理中",
              step: event.step || 1,
              totalSteps: event.totalSteps || 6,
              status: event.type === "node_start" ? "started" : "completed",
              parallel: event.parallel,
            };

            if (event.parallel) {
              recordedParallelAgents[info.agent] = info;
              setParallelAgents((prev) => ({
                ...prev,
                [info.agent]: info,
              }));
            } else {
              setCurrentProgress(info);
            }
          } else if (event.type === "token" && event.token) {
            accumulatedTokens += event.token;
            setStreamingText((prev) => prev + event.token);
          } else if (event.type === "error" && event.error) {
            setError(event.error);
          }
        },
        onError: (err) => {
          setError(err.message);
        },
      });

      // 流式结束：将主流程和并行专家的结果沉淀为结构化 StepsProgress 组件与总结文本
      const parallelItems = Object.values(recordedParallelAgents);
      const mainStepsMeta: StepItem[] = [
        { title: "需求分诊", description: "意图初筛与路由分发", status: "completed" },
        { title: "意图分类", description: "细粒度意图与领域划分", status: "completed" },
        { title: "需求提取", description: "关键实体与上下文抽取", status: "completed" },
        { title: "多维度分析", description: "并行专家集群深度评估", status: "completed" },
        { title: "综合报告", description: "跨专家结论智能汇聚", status: "completed" },
      ];
      const parallelStepsMeta: StepItem[] = parallelItems.map((p) => ({
        title: p.agentDisplayName,
        description: p.status === "completed" ? "专家评审完成" : "分析中",
        status: p.status === "completed" ? "completed" : "running",
        parallel: true,
      }));

      const assistantMsg: ChatMessage = {
        id: `assistant-stream-${Date.now()}`,
        role: "assistant",
        content:
          accumulatedTokens.trim() ||
          "✅ LangGraph Multi-Agent 深度图分析已完成，各领域专家已协同输出综合评估结论。",
        components: [
          {
            type: "steps",
            title: "Multi-Agent 拓扑执行链路",
            currentStep: 5,
            totalSteps: 5,
            status: "success",
            items: [...mainStepsMeta, ...parallelStepsMeta],
          },
        ],
        timestamp: new Date().toLocaleTimeString(),
      };

      updateMessages([...messages, userMsg, assistantMsg]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ 多智能体流式执行失败: ${msg}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      updateMessages([...messages, userMsg, errorMsg]);
    } finally {
      setIsStreaming(false);
      setLoading(false);
      setCurrentProgress(null);
      setParallelAgents({});
      setStreamingText("");
      abortControllerRef.current = null;
    }
  };

  // 发送自然语言对话
  const handleSendText = async (textToSend?: string) => {
    const raw = textToSend !== undefined ? textToSend : input;
    const trimmed = raw.trim();
    if (!trimmed || loading || isStreaming || !sessionId) return;

    setError(null);
    setInput("");

    // 若为首条消息，同步更新侧边栏会话标题
    if (messages.length === 0 && onUpdateSessionTitle) {
      const summaryTitle = trimmed.slice(0, 16);
      onUpdateSessionTitle(sessionId, summaryTitle);
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toLocaleTimeString(),
    };

    // 关键分支：若开启了 Multi-Agent 深度图分析模式，接入 /api/graph/stream SSE
    if (deepSearchEnabled) {
      updateMessages([...messages, userMsg]);
      await handleStreamGraph(trimmed, userMsg);
      return;
    }

    const nextMsgs = [...messages, userMsg];
    updateMessages(nextMsgs);
    setLoading(true);

    try {
      const res = await fetch(`${apiBaseUrl}/api/ui-chat/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          input: trimmed,
          model: currentModel?.modelName || "gpt-5.4",
          deepSearch: deepSearchEnabled,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`服务响应异常 (${res.status}): ${errText || res.statusText}`);
      }

      const resJson = (await res.json()) as unknown;
      const data = parseApiResponse(resJson);

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.message,
        components: data.components || [],
        context: data.context,
        timestamp: new Date().toLocaleTimeString(),
      };

      updateMessages([...nextMsgs, assistantMsg]);
      if (data.context) {
        setContext(data.context);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ 请求失败: ${msg}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      updateMessages([...nextMsgs, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // 处理 UI Protocol 交互回调
  const handleUIAction = async (action: UIAction) => {
    if (loading || !sessionId) return;
    setError(null);
    setLoading(true);

    // 用户操作展示反馈
    let feedbackContent = "执行操作";
    if (action.payload && typeof action.payload === "object") {
      const p = action.payload as Record<string, unknown>;
      if (p.type === "select") {
        const val = p.selectedValue ?? p.selectedId;
        feedbackContent = `已选择: ${Array.isArray(val) ? val.join(", ") : String(val ?? "")}`;
      } else if (p.type === "submit") {
        feedbackContent = `已提交需求配置表单`;
      } else if (p.type === "confirm") {
        feedbackContent = p.confirmed ? `确认分析结果` : `返回修改需求`;
      } else {
        feedbackContent = `已操作: ${action.actionKey || "继续"}`;
      }
    }

    const feedbackMsg: ChatMessage = {
      id: `feedback-${Date.now()}`,
      role: "user",
      content: feedbackContent,
      isActionFeedback: true,
      timestamp: new Date().toLocaleTimeString(),
    };

    // 若当前为表单提交，立即在消息流中插入图 1 风格的流水线进度条卡片
    const isFormSubmit = action.type === "form_submit";
    const progressId = `progress-${Date.now()}`;
    const initialProgressMsg: ChatMessage = {
      id: progressId,
      role: "assistant",
      content: "已收到您的需求规格，正在启动 Agent 深度分析流水线：",
      components: [
        {
          type: "progress",
          title: "需求提取",
          subtitle: "正在处理第 1 步，共 5 步",
          currentStep: 1,
          totalSteps: 5,
          percentage: 20,
          status: "processing",
        },
      ],
      timestamp: new Date().toLocaleTimeString(),
    };

    const nextMsgs = isFormSubmit
      ? [...messages, feedbackMsg, initialProgressMsg]
      : [...messages, feedbackMsg];
    updateMessages(nextMsgs);

    try {
      // 若是表单提交，启动平滑的流水线步骤推演
      let currentProgress = 20;
      let progressTimer: NodeJS.Timeout | null = null;

      if (isFormSubmit) {
        const stepsMeta = [
          { title: "需求提取", subtitle: "正在处理第 1 步，共 5 步", pct: 20 },
          { title: "实体与动作拆解", subtitle: "正在处理第 2 步，共 5 步", pct: 40 },
          { title: "架构与合规约束评估", subtitle: "正在处理第 3 步，共 5 步", pct: 60 },
          { title: "生成深度需求分析报告", subtitle: "正在处理第 4 步，共 5 步", pct: 80 },
          { title: "完成分析", subtitle: "5 步深度分析已全部完成", pct: 100 },
        ];

        let stepIndex = 0;
        progressTimer = setInterval(() => {
          stepIndex++;
          if (stepIndex < stepsMeta.length) {
            const meta = stepsMeta[stepIndex];
            currentProgress = meta.pct;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === progressId
                  ? {
                      ...m,
                      components: [
                        {
                          type: "progress",
                          title: meta.title,
                          subtitle: meta.subtitle,
                          currentStep: stepIndex + 1,
                          totalSteps: 5,
                          percentage: meta.pct,
                          status: meta.pct >= 100 ? "success" : "processing",
                        },
                      ],
                    }
                  : m
              )
            );
          } else if (progressTimer) {
            clearInterval(progressTimer);
          }
        }, 450);
      }

      const res = await fetch(`${apiBaseUrl}/api/ui-chat/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          action,
          context,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`操作响应异常 (${res.status}): ${errText || res.statusText}`);
      }

      const resJson = (await res.json()) as unknown;
      const data = parseApiResponse(resJson);

      // 若有进度条，等待最后一步动画收敛
      if (isFormSubmit) {
        await new Promise((r) => setTimeout(r, 600));
        // 将进度条固定为 100% 成功态
        setMessages((prev) =>
          prev.map((m) =>
            m.id === progressId
              ? {
                  ...m,
                  components: [
                    {
                      type: "progress",
                      title: "完成分析",
                      subtitle: "5 步深度分析已全部完成",
                      currentStep: 5,
                      totalSteps: 5,
                      percentage: 100,
                      status: "success",
                    },
                  ],
                }
              : m
          )
        );
      }

      // 紧接着下发图 5 风格的分析结果摘要与确认组件
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.message,
        components: data.components || [],
        context: data.context,
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => {
        const updated = [...prev, assistantMsg];
        if (sessionId) {
          try {
            localStorage.setItem(`autix_chat_msgs_${sessionId}`, JSON.stringify(updated));
          } catch {}
        }
        return updated;
      });

      if (data.context) {
        setContext(data.context);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ 操作处理失败: ${msg}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      updateMessages([...nextMsgs, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#000000] text-neutral-100 relative overflow-hidden font-sans">
      {/* 顶部模型切换胶囊条 (图 2 顶部) */}
      <header className="h-14 shrink-0 px-6 flex items-center border-b border-neutral-900 z-20">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-xs font-medium text-white border border-neutral-800 hover:border-neutral-700 transition cursor-pointer shadow-sm"
          >
            <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span>{currentModel?.name || "gpt-5.4"}</span>
            <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* 模型下拉菜单 */}
          {showModelDropdown && (
            <div className="absolute top-full left-0 mt-1.5 w-48 rounded-xl bg-[#141414] border border-neutral-800 p-1.5 shadow-2xl z-50">
              <div className="text-[10px] text-neutral-500 font-semibold px-2 py-1 uppercase">
                可用模型
              </div>
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectModel(m);
                    setShowModelDropdown(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                    currentModel?.id === m.id
                      ? "bg-neutral-800 text-white font-medium"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-900"
                  }`}
                >
                  <span>{m.name}</span>
                  {m.isDefault && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">
                      默认
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* 中部对话记录流 */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 custom-scrollbar max-w-4xl mx-auto w-full">
        {/* 欢迎开场白态 (图 2) */}
        {messages.length === 0 && (
          <div className="space-y-3 pt-2">
            <div className="text-sm sm:text-base text-neutral-200 leading-relaxed max-w-2xl">
              {DEFAULT_GREETING}
            </div>

            {/* 点赞与更多操作栏 */}
            <div className="flex items-center gap-2 pt-1 text-neutral-500">
              <button
                type="button"
                className="p-1 hover:text-neutral-300 transition cursor-pointer rounded"
                title="满意"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                </svg>
              </button>
              <button
                type="button"
                className="p-1 hover:text-neutral-300 transition cursor-pointer rounded"
                title="更多操作"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* 动态历史问答记录 */}
        {messages.map((msg) => {
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex flex-col space-y-2 ${isUser ? "items-end" : "items-start"}`}
            >
              {/* 文本内容 */}
              {msg.content && (
                <div
                  className={`rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed max-w-[85%] ${
                    isUser
                      ? msg.isActionFeedback
                        ? "bg-neutral-900 border border-neutral-800 text-neutral-300"
                        : "bg-neutral-800 text-white shadow-sm"
                      : "text-neutral-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              )}

              {/* 助手下发的 UI Protocol 组件 (图 3~5 渲染容器) */}
              {!isUser && msg.components && msg.components.length > 0 && (
                <div className="w-full space-y-4 pt-2">
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

              {/* 助手操作反馈小栏 */}
              {!isUser && (
                <div className="flex items-center gap-2 pt-0.5 text-neutral-500">
                  <button
                    type="button"
                    className="p-1 hover:text-neutral-300 transition cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="p-1 hover:text-neutral-300 transition cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* 流式动态思考指示器 (教程 9.2~9.6 前端多智能体流式与并行专家实时面板) */}
        {isStreaming && (
          <ThinkingIndicator
            progress={currentProgress}
            parallelAgents={parallelAgents}
            streamingText={streamingText}
          />
        )}

        {/* 非流式常规等待状态 */}
        {loading && !isStreaming && (
          <div className="flex items-center gap-2 text-xs text-neutral-400 pt-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span>AI 正在思考并组织协议组件...</span>
          </div>
        )}

        {/* 统一错误气泡提示 */}
        {error && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-3.5 py-2 text-xs text-rose-300 flex items-center justify-between">
            <span>⚠️ {error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-neutral-400 hover:text-white ml-2 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入框区 (图 2 底部拟真深黑组件) */}
      <div className="shrink-0 p-4 md:p-6 max-w-4xl mx-auto w-full z-10">
        <div className="rounded-2xl bg-[#111111] border border-neutral-800/90 p-3 shadow-2xl focus-within:border-neutral-700 transition">
          {/* 输入框文本域 */}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
            placeholder="描述您的需求或输入测试指令 (支持 Multi-Agent 流式图推演)..."
            rows={2}
            className="w-full bg-transparent text-sm text-neutral-100 placeholder-neutral-500 resize-none focus:outline-none custom-scrollbar"
          />

          {/* 底部功能工具栏 */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-900/80">
            <div className="flex items-center gap-2.5">
              {/* 回形针附件按钮 */}
              <button
                type="button"
                title="上传附件"
                className="p-1.5 text-neutral-500 hover:text-neutral-300 transition cursor-pointer rounded-lg hover:bg-neutral-800/60"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>

              {/* Multi-Agent 深度图分析模式胶囊 (9.6.3 核心流式开关) */}
              <button
                type="button"
                onClick={() => setDeepSearchEnabled(!deepSearchEnabled)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                  deepSearchEnabled
                    ? "bg-cyan-950/50 text-cyan-300 border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                    : "bg-neutral-900 text-neutral-400 border border-neutral-800 hover:border-neutral-700 hover:text-neutral-300"
                }`}
                title="开启后将调用 LangGraph 细粒度流式引擎与并行专家集群"
              >
                <span className={deepSearchEnabled ? "text-cyan-400" : "text-neutral-500"}>⚡</span>
                <span>Multi-Agent 深度流</span>
                {deepSearchEnabled && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                )}
              </button>
            </div>

            {/* 发送 / 中止按钮 */}
            {isStreaming ? (
              <button
                type="button"
                onClick={() => abortControllerRef.current?.abort()}
                title="中断生成"
                className="w-7 h-7 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/50 flex items-center justify-center transition cursor-pointer"
              >
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-400" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSendText()}
                disabled={!input.trim() || loading}
                title="发送"
                className="w-7 h-7 rounded-xl bg-neutral-800 hover:bg-cyan-600 text-neutral-400 hover:text-white flex items-center justify-center transition disabled:opacity-30 disabled:hover:bg-neutral-800 disabled:hover:text-neutral-400 cursor-pointer disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
