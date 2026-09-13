"use client";

import React from "react";
import type { UIResponse, UIAction } from "@/types/ui-protocol";
import { SelectionCard } from "./SelectionCard";
import { DynamicForm } from "./DynamicForm";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { InfoCard } from "./InfoCard";
import { StepsProgress } from "./StepsProgress";
import { DataTable } from "./DataTable";
import { ActionButtons } from "./ActionButtons";
import { ProgressCard } from "./ProgressCard";

export interface ComponentRendererProps {
  component: UIResponse;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

/**
 * AI UI 组件映射分发器
 * 根据 UIResponse 的 type 字段严格收窄并映射渲染对应的 React 组件
 */
export const ComponentRenderer: React.FC<ComponentRendererProps> = ({
  component,
  onAction,
  disabled = false,
}) => {
  if (!component || !component.type) {
    return (
      <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">
        无效的 UI 组件数据: 缺少 type 属性
      </div>
    );
  }

  switch (component.type) {
    case "selection":
      return (
        <SelectionCard
          data={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case "form":
      return (
        <DynamicForm
          data={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case "confirmation":
      return (
        <ConfirmationDialog
          data={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case "card":
      return (
        <InfoCard
          data={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case "steps":
      return <StepsProgress data={component} />;

    case "table":
      return (
        <DataTable
          data={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case "action_buttons":
      return (
        <ActionButtons
          data={component}
          onAction={onAction}
          disabled={disabled}
        />
      );

    case "progress":
      return <ProgressCard data={component} />;

    case "text":
      return (
        <div className="w-full rounded-xl border border-neutral-800/80 bg-neutral-900/60 p-3.5 text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap text-left">
          {component.content}
        </div>
      );

    default: {
      const unknownComponent = component as { type: string };
      return (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-left">
          <div className="text-[11px] font-mono text-neutral-400">
            [未识别的 UI 组件类型: {unknownComponent.type}]
          </div>
          <pre className="mt-1 max-h-32 overflow-auto text-[10px] text-neutral-500 custom-scrollbar">
            {JSON.stringify(unknownComponent, null, 2)}
          </pre>
        </div>
      );
    }
  }
};
