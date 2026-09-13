"use client";

import React from "react";
import type { ActionButtonsComponent, ActionButton, UIAction } from "@/types/ui-protocol";

interface ActionButtonsProps {
  data: ActionButtonsComponent;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  data,
  onAction,
  disabled = false,
}) => {
  const isVertical = data.layout === "vertical";

  const handleButtonClick = (btn: ActionButton) => {
    if (disabled) return;
    onAction?.({
      componentType: "action_buttons",
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
    <div className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 p-4 shadow-lg backdrop-blur-sm text-left">
      {data.title && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold tracking-wide text-neutral-300">
            {data.title}
          </h4>
        </div>
      )}

      <div
        className={`flex ${
          isVertical
            ? "flex-col space-y-2"
            : "flex-wrap items-center gap-2.5"
        }`}
      >
        {data.buttons.map((btn, idx) => {
          const isPrimary = btn.variant === "primary";
          const isDanger = btn.variant === "danger";

          return (
            <button
              key={btn.id || idx}
              type="button"
              disabled={disabled}
              onClick={() => handleButtonClick(btn)}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                isVertical ? "w-full text-center" : ""
              } ${
                isPrimary
                  ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-600/20"
                  : isDanger
                    ? "bg-rose-600 text-white hover:bg-rose-500 shadow-sm shadow-rose-600/20"
                    : "border border-neutral-700/80 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800 hover:text-white"
              }`}
            >
              {btn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
