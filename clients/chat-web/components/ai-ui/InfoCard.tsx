"use client";

import React from "react";
import type { CardComponent, ActionButton, UIAction } from "@/types/ui-protocol";

interface InfoCardProps {
  data: CardComponent;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

export const InfoCard: React.FC<InfoCardProps> = ({
  data,
  onAction,
  disabled = false,
}) => {
  const handleActionClick = (btn: ActionButton) => {
    if (disabled) return;
    onAction?.({
      componentType: "card",
      actionKey: btn.actionKey,
      type: "button_click",
      payload: {
        type: "click",
        actionId: btn.id,
        actionKey: btn.actionKey,
        ...btn.payload,
      },
    });
  };

  return (
    <div className="w-full rounded-2xl border border-neutral-800/90 bg-[#121212] p-5 shadow-2xl text-left transition-all">
      {/* 头部标题与圆圈 i 图标 (图 5 上半卡片) */}
      <div className="flex items-center gap-2.5 pb-4 border-b border-neutral-900">
        <div className="w-5 h-5 rounded-full border border-neutral-600 flex items-center justify-center text-neutral-300 text-xs font-serif font-bold">
          i
        </div>
        <h3 className="text-sm sm:text-base font-semibold text-neutral-100">
          {data.title || "分析结果摘要"}
        </h3>
        {data.status && (
          <span className="ml-auto inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 text-[11px] font-medium text-blue-400">
            {data.status}
          </span>
        )}
      </div>

      {/* 左右对齐的两列式 Key-Value 清单 (图 5 风格) */}
      <div className="mt-4 space-y-3">
        {data.fields.map((field, idx) => (
          <div
            key={idx}
            className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 text-xs sm:text-sm"
          >
            <span className="text-neutral-400 shrink-0 font-medium sm:w-32">
              {field.label}
            </span>
            <span className="text-neutral-200 font-normal sm:text-right flex-1 break-words">
              {field.value || "-"}
            </span>
          </div>
        ))}
      </div>

      {/* 底部按钮 (如有) */}
      {data.actions && data.actions.length > 0 && (
        <div className="mt-5 flex items-center justify-end gap-3 pt-3 border-t border-neutral-900">
          {data.actions.map((btn, idx) => (
            <button
              key={btn.id || idx}
              type="button"
              disabled={disabled}
              onClick={() => handleActionClick(btn)}
              className={`px-5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50 ${
                btn.variant === "primary"
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
