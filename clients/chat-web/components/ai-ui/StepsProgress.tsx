"use client";

import React from "react";
import type { StepsComponent, StepItem } from "@/types/ui-protocol";

interface StepsProgressProps {
  data: StepsComponent;
}

const EXPERT_META: Record<string, { name: string; icon: string; tag: string }> =
  {
    functional_expert: { name: "功能分析专家", icon: "🧩", tag: "功能与交互" },
    performance_expert: { name: "性能分析专家", icon: "⚡", tag: "负载与吞吐" },
    security_expert: { name: "安全分析专家", icon: "🛡️", tag: "威胁与鉴权" },
    compliance_expert: { name: "合规分析专家", icon: "⚖️", tag: "法规与隐私" },
  };

export const StepsProgress: React.FC<StepsProgressProps> = ({ data }) => {
  const allSteps: StepItem[] = data.items || data.steps || [];
  const current = data.currentStep ?? 0;

  // 区分主流程步骤与 9.2~9.3 并行专家子任务
  const mainSteps = allSteps.filter(
    (s) =>
      !s.parallel &&
      !s.label?.includes("_expert") &&
      !s.title.includes("_expert"),
  );
  const parallelSteps = allSteps.filter(
    (s) =>
      Boolean(s.parallel) ||
      s.label?.includes("_expert") ||
      s.title.includes("_expert"),
  );

  const getStepStatus = (
    item: StepItem,
    index: number,
  ): "finish" | "process" | "wait" | "error" => {
    if (item.status === "completed") return "finish";
    if (item.status === "running") return "process";
    if (item.status)
      return item.status as "finish" | "process" | "wait" | "error";
    if (index < current) return "finish";
    if (index === current) return "process";
    return "wait";
  };

  return (
    <div className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 p-4 shadow-lg backdrop-blur-sm text-left">
      {data.title && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold tracking-wide text-neutral-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
            {data.title}
          </h3>
        </div>
      )}

      {/* 1. 主流程步骤条横向流 */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-2">
        {mainSteps.map((step, idx) => {
          const status = getStepStatus(step, idx);
          const isLast = idx === mainSteps.length - 1;

          return (
            <React.Fragment key={idx}>
              <div className="flex items-center gap-3 md:flex-col md:items-center md:text-center flex-1 min-w-22.5">
                {/* 节点图标/序号 */}
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                    status === "finish"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                      : status === "process"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400 ring-2 ring-cyan-500/30 animate-pulse"
                        : status === "error"
                          ? "bg-rose-500/20 text-rose-400 border border-rose-500"
                          : "bg-neutral-900 text-neutral-500 border border-neutral-800"
                  }`}
                >
                  {status === "finish"
                    ? "✓"
                    : status === "error"
                      ? "✕"
                      : idx + 1}
                </div>

                {/* 标题与描述 */}
                <div className="min-w-0">
                  <div
                    className={`text-xs font-medium truncate ${
                      status === "process"
                        ? "text-cyan-300 font-semibold"
                        : status === "finish"
                          ? "text-neutral-200"
                          : status === "error"
                            ? "text-rose-400"
                            : "text-neutral-500"
                    }`}
                  >
                    {step.title}
                  </div>
                  {step.description && (
                    <div className="mt-0.5 text-[10px] text-neutral-400 truncate max-w-35 md:max-w-none">
                      {step.description}
                    </div>
                  )}
                </div>
              </div>

              {/* 步骤间连接线 (仅桌面端展示) */}
              {!isLast && (
                <div
                  className={`hidden md:block h-0.5 flex-1 transition-colors ${
                    idx < current ? "bg-emerald-500/50" : "bg-neutral-800"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 2. 第九章 9.6.3.4 并行专家集群独立面板 */}
      {parallelSteps.length > 0 && (
        <div className="mt-4 pt-3.5 border-t border-neutral-800/70">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-xs font-medium text-neutral-300 flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-semibold text-cyan-400">
                并行专家集群分析 (Parallel Multi-Agent)
              </span>
            </div>
            <span className="text-[10px] text-neutral-400 font-mono">
              {
                parallelSteps.filter(
                  (s) => s.status === "completed" || s.status === "finish",
                ).length
              }{" "}
              / {parallelSteps.length} 专家就绪
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {parallelSteps.map((expert, eIdx) => {
              const key = expert.label || expert.title;
              const meta = EXPERT_META[key] || {
                name: expert.title || key,
                icon: "🤖",
                tag: "专业分析",
              };
              const isDone =
                expert.status === "completed" || expert.status === "finish";
              const isRunning =
                expert.status === "running" || expert.status === "process";

              return (
                <div
                  key={eIdx}
                  className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all ${
                    isDone
                      ? "border-emerald-500/30 bg-emerald-950/10 text-neutral-200"
                      : isRunning
                        ? "border-cyan-500/40 bg-cyan-950/20 text-cyan-100 shadow-[0_0_10px_rgba(6,182,212,0.1)]"
                        : "border-neutral-800/80 bg-neutral-900/40 text-neutral-400"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">{meta.icon}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-1.5">
                        <span>{meta.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800/80 text-neutral-400 shrink-0">
                          {meta.tag}
                        </span>
                      </div>
                      {expert.description && (
                        <div className="text-[10px] text-neutral-400 truncate mt-0.5">
                          {expert.description}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 ml-2">
                    {isDone ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-medium">
                        ✓ 已完成
                      </span>
                    ) : isRunning ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-medium animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        评审中
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-400">
                        等待调度
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
