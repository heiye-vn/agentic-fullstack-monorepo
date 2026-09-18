"use client";

import React from "react";

export interface ProgressInfo {
  agent: string;
  agentDisplayName: string;
  step: number;
  totalSteps: number;
  status: "started" | "completed";
  parallel?: boolean;
}

export interface ThinkingIndicatorProps {
  message?: string;
  progress?: ProgressInfo | null;
  /** 9.2~9.3 并行子图专家进度（按 agent 名去重） */
  parallelAgents?: Record<string, ProgressInfo>;
  /** 实时打字机 Token 预览 */
  streamingText?: string;
}

const EXPERT_META: Record<string, { icon: string; tag: string }> = {
  functional_expert: { icon: "🧩", tag: "功能与交互" },
  performance_expert: { icon: "⚡", tag: "负载与吞吐" },
  security_expert: { icon: "🛡️", tag: "威胁与鉴权" },
  compliance_expert: { icon: "⚖️", tag: "法规与隐私" },
};

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  message = "LangGraph 多智能体正在编排分析",
  progress,
  parallelAgents,
  streamingText,
}) => {
  const percentage =
    progress && progress.totalSteps > 0
      ? Math.min(100, Math.round((progress.step / progress.totalSteps) * 100))
      : 0;

  const parallelList = Object.values(parallelAgents || {});

  return (
    <div className="w-full flex justify-start my-2">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/90 p-4 shadow-xl backdrop-blur-md">
        {/* 顶部主状态栏 */}
        <div className="flex items-center gap-3">
          {/* 动态呼吸/跳动小球 */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-950/60 border border-cyan-800/50">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
            </div>
          </div>

          {/* 文本描述与步数提示 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-100 truncate">
                {progress ? progress.agentDisplayName : message}
              </span>
              <span className="inline-flex items-center rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 border border-cyan-500/20">
                Multi-Agent Graph
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              {progress
                ? `正在执行第 ${progress.step} 步，共 ${progress.totalSteps} 步`
                : "正在初始化智能体拓扑图..."}
            </div>
          </div>

          {/* 进度百分比 */}
          {progress && (
            <div className="rounded-lg bg-neutral-800/80 px-2 py-1 text-xs font-mono font-medium text-cyan-300 border border-neutral-700">
              {percentage}%
            </div>
          )}
        </div>

        {/* 主流程平滑进度条 */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-linear-to-r from-cyan-500 via-blue-500 to-indigo-500 transition-all duration-500 ease-out"
            style={{ width: progress ? `${Math.max(5, percentage)}%` : '0%' }}
          />
        </div>

        {/* 9.2~9.3 教程重点：并行专家集群 (Parallel Multi-Agent) 实时运行面板 */}
        {parallelList.length > 0 && (
          <div className="mt-1 flex flex-col gap-2 rounded-xl border border-neutral-800/80 bg-neutral-950/60 p-3">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 font-medium text-neutral-300">
                <span className="inline-flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                <span>⚡ 并行专家集群动态协同 (Parallel Subgraph)</span>
              </div>
              <span className="font-mono text-[10px] text-neutral-500">
                {parallelList.filter((p) => p.status === "completed").length} /{" "}
                {parallelList.length} 完成
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {parallelList.map((item) => {
                const meta = EXPERT_META[item.agent] || {
                  icon: "🤖",
                  tag: "专家分析",
                };
                const isCompleted = item.status === "completed";

                return (
                  <div
                    key={item.agent}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-all border ${
                      isCompleted
                        ? "bg-emerald-950/20 border-emerald-500/30 text-neutral-200"
                        : "bg-cyan-950/20 border-cyan-500/40 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.1)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-sm">{meta.icon}</span>
                      <div className="flex flex-col truncate">
                        <span className="font-medium truncate">
                          {item.agentDisplayName}
                        </span>
                        <span className="text-[9px] text-neutral-400">
                          {meta.tag}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5 ml-2">
                      {isCompleted ? (
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/50">
                          ✓
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                          <span className="text-[10px] text-cyan-400 font-mono">
                            running
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 细粒度流式打字机 Token 输出展示 */}
        {streamingText && (
          <div className="mt-1 rounded-xl bg-neutral-950/70 border border-neutral-800/80 p-2.5 text-xs text-neutral-300 font-mono leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
            <span className="text-cyan-400 font-semibold mr-1">▍</span>
            {streamingText}
          </div>
        )}
      </div>
    </div>
  );
};
