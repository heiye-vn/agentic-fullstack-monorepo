"use client";

import React from "react";
import type { ProgressComponent } from "@/types/ui-protocol";

interface ProgressCardProps {
  data: ProgressComponent;
}

export const ProgressCard: React.FC<ProgressCardProps> = ({ data }) => {
  const {
    title = "需求提取",
    subtitle = `正在处理第 ${data.currentStep || 1} 步，共 ${data.totalSteps || 5} 步`,
    percentage = 20,
    status = "processing",
  } = data;

  const isCompleted = percentage >= 100 || status === "success";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-neutral-800/90 bg-[#121316] p-4 shadow-2xl backdrop-blur-md transition-all select-none">
      {/* 头部信息区 (图 1: 左侧 Spinner, 中间标题与步数, 右侧百分比徽章) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* 左侧旋转发光圈 */}
          <div className="relative flex items-center justify-center shrink-0 w-6 h-6">
            {isCompleted ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-emerald-400 text-xs font-bold shadow-[0_0_8px_rgba(16,185,129,0.5)]">
                ✓
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-neutral-800 border-t-indigo-500 border-r-purple-500 animate-spin shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
            )}
          </div>

          {/* 标题与阶段说明 */}
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-semibold text-neutral-100 tracking-tight truncate">
              {title}
            </h4>
            <p className="text-[11px] text-neutral-400 truncate mt-0.5">
              {isCompleted ? "5 步深度分析已全部完成" : subtitle}
            </p>
          </div>
        </div>

        {/* 右侧渐变发光百分比胶囊 (图 1) */}
        <div className="shrink-0">
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold tracking-tight transition-all duration-300 ${
              isCompleted
                ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                : "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.45)]"
            }`}
          >
            {Math.round(percentage)}%
          </span>
        </div>
      </div>

      {/* 底部渐变平滑进度条 (图 1) */}
      <div className="mt-3.5 h-1.5 w-full rounded-full bg-neutral-900/90 overflow-hidden border border-neutral-800/40">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isCompleted
              ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
              : "bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.6)]"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
};
