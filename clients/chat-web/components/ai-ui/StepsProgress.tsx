"use client";

import React from "react";
import type { StepsComponent, StepItem } from "@/types/ui-protocol";

interface StepsProgressProps {
  data: StepsComponent;
}

export const StepsProgress: React.FC<StepsProgressProps> = ({ data }) => {
  const stepItems: StepItem[] = data.items || data.steps || [];
  const current = data.currentStep ?? 0;

  const getStepStatus = (
    item: StepItem,
    index: number
  ): "finish" | "process" | "wait" | "error" => {
    if (item.status) return item.status;
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

      {/* 步骤条横向流 */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-2">
        {stepItems.map((step, idx) => {
          const status = getStepStatus(step, idx);
          const isLast = idx === stepItems.length - 1;

          return (
            <React.Fragment key={idx}>
              <div className="flex items-center gap-3 md:flex-col md:items-center md:text-center flex-1 min-w-[90px]">
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
                  {status === "finish" ? "✓" : status === "error" ? "✕" : idx + 1}
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
                    <div className="mt-0.5 text-[10px] text-neutral-400 truncate max-w-[140px] md:max-w-none">
                      {step.description}
                    </div>
                  )}
                </div>
              </div>

              {/* 步骤间连接线 (仅桌面端展示) */}
              {!isLast && (
                <div
                  className={`hidden md:block h-[2px] flex-1 transition-colors ${
                    idx < current ? "bg-emerald-500/50" : "bg-neutral-800"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
