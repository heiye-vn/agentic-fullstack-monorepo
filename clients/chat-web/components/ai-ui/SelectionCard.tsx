"use client";

import React, { useState } from "react";
import type {
  SelectionComponent,
  SelectionOption,
  UIAction,
} from "@/types/ui-protocol";

interface SelectionCardProps {
  data: SelectionComponent;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

export const SelectionCard: React.FC<SelectionCardProps> = ({
  data,
  onAction,
  disabled = false,
}) => {
  const isMultiple = data.mode === "multiple" || !!data.allowMultiple;
  // 默认选中第一项或未选
  const [selectedValues, setSelectedValues] = useState<string[]>(() => {
    return data.options.length > 0 ? [data.options[0].value] : [];
  });

  const handleSelectOption = (option: SelectionOption) => {
    if (disabled || option.disabled) return;
    if (isMultiple) {
      setSelectedValues((prev) =>
        prev.includes(option.value)
          ? prev.filter((v) => v !== option.value)
          : [...prev, option.value]
      );
    } else {
      setSelectedValues([option.value]);
    }
  };

  const handleConfirm = () => {
    if (disabled || selectedValues.length === 0) return;
    onAction?.({
      componentType: "selection",
      actionKey: data.actionKey || "select_requirement_type",
      type: "selection",
      payload: {
        type: "select",
        selectedId: isMultiple ? selectedValues : selectedValues[0],
        selectedValue: isMultiple ? selectedValues : selectedValues[0],
      },
    });
  };

  const handleCancel = () => {
    if (disabled) return;
    onAction?.({
      componentType: "selection",
      actionKey: "cancel_selection",
      type: "selection",
      payload: {
        type: "cancel",
      },
    });
  };

  return (
    <div className="w-full rounded-2xl border border-neutral-800/90 bg-[#121212] p-5 shadow-2xl transition-all">
      {/* 标题栏 (图 3) */}
      <div className="mb-4">
        <h3 className="text-sm sm:text-base font-semibold text-neutral-100">
          {data.title || "请选择您的需求类型"}
        </h3>
        {data.description && (
          <p className="mt-1 text-xs text-neutral-400">{data.description}</p>
        )}
      </div>

      {/* 2x2 网格选项卡片 (图 3) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.options.map((opt) => {
          const isSelected = selectedValues.includes(opt.value);
          const isItemDisabled = disabled || opt.disabled;

          return (
            <div
              key={opt.id || opt.value}
              onClick={() => handleSelectOption(opt)}
              className={`relative flex items-start gap-3 rounded-2xl border p-4 transition-all duration-200 cursor-pointer select-none ${
                isSelected
                  ? "border-blue-500 bg-[#131722]/80 ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                  : "border-neutral-800/80 bg-[#171717]/60 hover:border-neutral-700 hover:bg-[#1a1a1a]"
              } ${isItemDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {/* 单选圆圈指示器 (Radio Indicator) */}
              <div className="pt-0.5 shrink-0">
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                      : "border-neutral-600 bg-neutral-900"
                  }`}
                >
                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </div>

              {/* 文本内容 */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-xs sm:text-sm text-neutral-100">
                  {opt.label}
                </div>
                {opt.description && (
                  <div className="mt-1 text-xs text-neutral-400 leading-normal">
                    {opt.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部操作栏 (图 3 右下角取消与确认按钮) */}
      <div className="mt-5 flex items-center justify-end gap-3 pt-3 border-t border-neutral-900/60">
        <button
          type="button"
          disabled={disabled}
          onClick={handleCancel}
          className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-white transition cursor-pointer disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          disabled={disabled || selectedValues.length === 0}
          onClick={handleConfirm}
          className="px-6 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_14px_rgba(37,99,235,0.4)] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          确认
        </button>
      </div>
    </div>
  );
};
