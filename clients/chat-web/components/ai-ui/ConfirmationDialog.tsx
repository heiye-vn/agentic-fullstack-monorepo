"use client";

import React from "react";
import type { ConfirmationComponent, UIAction } from "@/types/ui-protocol";

interface ConfirmationDialogProps {
  data: ConfirmationComponent;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  data,
  onAction,
  disabled = false,
}) => {
  const handleConfirm = (confirmed: boolean) => {
    if (disabled) return;
    onAction?.({
      componentType: "confirmation",
      actionKey: data.actionKey || "confirm_analysis_result",
      type: "confirmation",
      payload: {
        type: "confirm",
        confirmed,
      },
    });
  };

  return (
    <div className="w-full rounded-2xl border border-neutral-800/90 bg-[#121212] p-5 shadow-2xl text-left transition-all space-y-4">
      {/* 头部标题与绿色打勾圆圈 (图 5 下半卡片) */}
      <div className="flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-full border border-emerald-500 bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-xs font-bold shadow-[0_0_8px_rgba(16,185,129,0.3)]">
          ✓
        </div>
        <h3 className="text-sm sm:text-base font-semibold text-neutral-100">
          {data.title || "确认分析结果"}
        </h3>
      </div>

      {/* 操作摘要描述 */}
      <div className="space-y-1.5 text-xs sm:text-sm">
        <div className="font-semibold text-neutral-300">操作摘要</div>
        <p className="text-neutral-400 leading-relaxed">
          {data.summary ||
            "已完成需求分析，当前已整理出需求概述、功能分解、验收标准、依赖关系、补充建议及风险评估。请确认该分析结果是否作为后续细化输入。"}
        </p>
      </div>

      {/* 影响评估警示卡片 (图 5 内嵌黄色警告框) */}
      <div className="rounded-xl border border-amber-500/30 bg-[#19160d] p-3.5 flex items-start gap-2.5">
        <div className="w-4 h-4 rounded-full border border-amber-500/60 flex items-center justify-center text-amber-400 text-[10px] shrink-0 mt-0.5">
          !
        </div>
        <div className="text-xs space-y-0.5">
          <div className="font-semibold text-amber-300">影响评估</div>
          <div className="text-amber-200/80 leading-normal">
            {data.warning || "确认后可进入下一步需求细化或方案设计。"}
          </div>
        </div>
      </div>

      {/* 底部确认与返回修改操作栏 (图 5 右下角按钮) */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleConfirm(false)}
          className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-white transition cursor-pointer disabled:opacity-50"
        >
          {data.cancelText || "返回修改"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleConfirm(true)}
          className="px-6 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_14px_rgba(37,99,235,0.4)] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {data.confirmText || "确认结果"}
        </button>
      </div>
    </div>
  );
};
