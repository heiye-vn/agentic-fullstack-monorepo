"use client";

import React, { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SelectionCard } from "@/components/ai-ui/SelectionCard";
import { DynamicForm } from "@/components/ai-ui/DynamicForm";
import { ConfirmationDialog } from "@/components/ai-ui/ConfirmationDialog";
import { InfoCard } from "@/components/ai-ui/InfoCard";
import { StepsProgress } from "@/components/ai-ui/StepsProgress";
import { DataTable } from "@/components/ai-ui/DataTable";
import { ActionButtons } from "@/components/ai-ui/ActionButtons";
import type {
  UIAction,
  SelectionComponent,
  FormComponent,
  ConfirmationComponent,
  CardComponent,
  StepsComponent,
  TableComponent,
  ActionButtonsComponent,
} from "@/types/ui-protocol";

// 示例 Mock 数据集
const MOCK_SELECTION: SelectionComponent = {
  type: "selection",
  title: "需求类型判定 (SelectionCard 演示)",
  description: "请为本次新录入的需求选择归属类型（点击选项即刻触发 onAction 回调）",
  mode: "single",
  actionKey: "select_requirement_type",
  options: [
    {
      value: "functional",
      label: "核心功能性需求",
      description: "涉及前台用户可见的业务功能、界面交互或业务流转逻辑变更",
    },
    {
      value: "performance",
      label: "高并发与性能优化",
      description: "针对系统响应延迟、高并发吞吐量、缓存机制或 SQL 慢查询优化",
    },
    {
      value: "security",
      label: "安全合规与鉴权",
      description: "权限越权校验、敏感数据脱敏、加密传输或三方等保合规要求",
    },
  ],
};

const MOCK_FORM: FormComponent = {
  type: "form",
  title: "需求详细字段录入 (DynamicForm 演示)",
  description: "支持 input、select、textarea、number 等多种类型表单字段动态生成",
  submitText: "确认并提交需求分析",
  actionKey: "submit_req_form",
  fields: [
    {
      name: "title",
      label: "需求标题",
      type: "input",
      placeholder: "例如：支持飞书扫码快捷登录",
      required: true,
      defaultValue: "用户批量导入导出 Excel 数据",
    },
    {
      name: "priority",
      label: "需求优先级",
      type: "select",
      required: true,
      defaultValue: "P1",
      options: [
        { label: "P0 - 阻断级 (立即响应)", value: "P0" },
        { label: "P1 - 核心级 (本周排期)", value: "P1" },
        { label: "P2 - 次要级 (常规迭代)", value: "P2" },
      ],
    },
    {
      name: "expectedRows",
      label: "单次导入预估记录上限",
      type: "number",
      placeholder: "例如：5000",
      defaultValue: 1000,
    },
    {
      name: "detailDescription",
      label: "业务背景与约束描述",
      type: "textarea",
      placeholder: "请阐明具体业务诉求与约束条件...",
      defaultValue: "支持常见 .xlsx 格式文件解析，导入前需校验手机号唯一性。",
    },
  ],
};

const MOCK_CONFIRMATION: ConfirmationComponent = {
  type: "confirmation",
  title: "需求评审发布确认 (ConfirmationDialog 演示)",
  summary: "您即将把当前需求工单推向下一评审阶段，系统将自动分配架构师跟进。",
  warning: "提交确认后需求标题与核心参数将被冻结，如需变更需走审批流程。",
  confirmText: "确认并冻结提交",
  cancelText: "返回继续修改",
  actionKey: "confirm_req_submit",
  details: {
    需求流水号: "REQ-2026-0913-088",
    需求类型: "核心功能性需求 (Functional)",
    排期优先级: "P1",
    预计工期: "3 个迭代工作日",
  },
};

const MOCK_INFO_CARD: CardComponent = {
  type: "card",
  title: "需求分析详情卡片 (InfoCard 演示)",
  subtitle: "REQ-20260913-AUTO-01",
  status: "进行中 (In Review)",
  fields: [
    { label: "核心动作", value: "批量导入并校验 Excel 数据" },
    { label: "主要约束", value: "单次导出不能超过1000条；须校验手机号" },
    { label: "涉及实体", value: "操作日志、手机号、Excel文件" },
    { label: "评估模型", value: "Qwen / DeepSeek-V3 Structured Output" },
  ],
  footer: "最后同步时间: 2026-09-13 11:20:00 UTC+8",
  actions: [
    { id: "view_diff", label: "查看代码变更", variant: "secondary" },
    { id: "approve", label: "通过评审", variant: "primary" },
  ],
};

const MOCK_STEPS: StepsComponent = {
  type: "steps",
  title: "需求分析处理生命周期 (StepsProgress 演示)",
  currentStep: 2,
  items: [
    { title: "需求发起", description: "自然语言提取" },
    { title: "分类定界", description: "类型匹配与规则" },
    { title: "表单录入", description: "参数动态采集" },
    { title: "架构评审", description: "安全与契约审查" },
    { title: "归档排期", description: "转为 Sprint 任务" },
  ],
};

const MOCK_TABLE: TableComponent = {
  type: "table",
  title: "历史关联合规需求数据 (DataTable 演示)",
  selectable: true,
  columns: [
    { key: "id", title: "工单编号", width: 140 },
    { key: "action", title: "核心动作" },
    { key: "constraints", title: "主要约束" },
    { key: "status", title: "状态", width: 100 },
  ],
  rows: [
    {
      id: "REQ-2026-001",
      action: "用户注册绑定手机号",
      constraints: "密码至少8位；手机号唯一",
      status: "已归档",
    },
    {
      id: "REQ-2026-002",
      action: "报表批量异步导出",
      constraints: "单次不得超过1000条；带操作日志",
      status: "进行中",
    },
    {
      id: "REQ-2026-003",
      action: "订单退款审核原路返回",
      constraints: "须在7天内申请；已消费金额不可退",
      status: "待评审",
    },
  ],
};

const MOCK_ACTION_BUTTONS: ActionButtonsComponent = {
  type: "action_buttons",
  title: "流程快捷控制组 (ActionButtons 演示)",
  layout: "horizontal",
  buttons: [
    { id: "btn_re_extract", label: "重新分析需求", variant: "primary", actionKey: "re_extract" },
    { id: "btn_export", label: "导出标准 Markdown 契约", variant: "secondary", actionKey: "export_md" },
    { id: "btn_discard", label: "放弃当前草稿", variant: "danger", actionKey: "discard" },
  ],
};

export default function UIGalleryPage() {
  const [actionLogs, setActionLogs] = useState<
    Array<{ timestamp: string; action: UIAction }>
  >([]);

  const handleAction = (action: UIAction) => {
    const newLog = {
      timestamp: new Date().toLocaleTimeString(),
      action,
    };
    setActionLogs((prev) => [newLog, ...prev.slice(0, 19)]);
  };

  const handleClearLogs = () => {
    setActionLogs([]);
  };

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#000000] text-neutral-100 flex flex-col p-4 md:p-6 selection:bg-white selection:text-black relative font-sans">
      {/* 顶部微弱冷光雾化 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-200 h-75 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04)_0%,transparent_70%)] pointer-events-none" />

      {/* 统一全局导航栏 */}
      <Navbar />

      {/* 核心工作台：左侧组件陈列，右侧实时 Action 回显 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4 z-10">
        {/* 左侧：全部 7 大基础组件 Showcase (8 列) */}
        <section className="lg:col-span-8 flex flex-col h-full bg-[#0a0a0a] border border-neutral-800/80 rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden">
          <div className="shrink-0 flex items-center justify-between pb-3 border-b border-neutral-800/80 mb-3">
            <div>
              <h2 className="text-xs sm:text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
                UI 协议组件全景沙盒 (7 大基础组件 Showcase)
              </h2>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                点击下方任意组件的按钮、卡片、表单或行，均会实时捕获并向右侧控制台输出 onAction 载荷
              </p>
            </div>
            <span className="text-[11px] font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
              7 Components Ready
            </span>
          </div>

          {/* 可滚动组件展示区 */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1 custom-scrollbar">
            {/* 1. StepsProgress */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider block">
                01. 步骤指示器 (StepsProgress)
              </span>
              <StepsProgress data={MOCK_STEPS} />
            </div>

            {/* 2. SelectionCard */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-indigo-400 uppercase tracking-wider block">
                02. 选项卡片 (SelectionCard)
              </span>
              <SelectionCard data={MOCK_SELECTION} onAction={handleAction} />
            </div>

            {/* 3. DynamicForm */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-emerald-400 uppercase tracking-wider block">
                03. 动态表单 (DynamicForm)
              </span>
              <DynamicForm data={MOCK_FORM} onAction={handleAction} />
            </div>

            {/* 4. ConfirmationDialog */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-amber-400 uppercase tracking-wider block">
                04. 二次确认面板 (ConfirmationDialog)
              </span>
              <ConfirmationDialog data={MOCK_CONFIRMATION} onAction={handleAction} />
            </div>

            {/* 5. InfoCard */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-purple-400 uppercase tracking-wider block">
                05. 结构化信息卡 (InfoCard)
              </span>
              <InfoCard data={MOCK_INFO_CARD} onAction={handleAction} />
            </div>

            {/* 6. DataTable */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-blue-400 uppercase tracking-wider block">
                06. 数据表格 (DataTable)
              </span>
              <DataTable data={MOCK_TABLE} onAction={handleAction} />
            </div>

            {/* 7. ActionButtons */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono text-rose-400 uppercase tracking-wider block">
                07. 操作按钮组 (ActionButtons)
              </span>
              <ActionButtons data={MOCK_ACTION_BUTTONS} onAction={handleAction} />
            </div>
          </div>
        </section>

        {/* 右侧：实时 UIAction 回显监视器 (4 列) */}
        <section className="lg:col-span-4 flex flex-col h-full bg-[#0a0a0a] border border-neutral-800/80 rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden">
          <div className="shrink-0 flex items-center justify-between pb-3 border-b border-neutral-800/80 mb-3">
            <h3 className="text-xs sm:text-sm font-semibold text-neutral-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.6)]" />
              Action 交互捕获终端
            </h3>

            {actionLogs.length > 0 && (
              <button
                type="button"
                onClick={handleClearLogs}
                className="text-[11px] text-neutral-400 hover:text-white px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 transition cursor-pointer"
              >
                清空日志
              </button>
            )}
          </div>

          {/* Action JSON 输出流 */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 custom-scrollbar">
            {actionLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-500 space-y-2">
                <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500">
                  ⚡
                </div>
                <p className="text-xs font-medium text-neutral-300">
                  暂无交互触发
                </p>
                <p className="text-[11px] text-neutral-500 max-w-xs">
                  点击左侧任意卡片、表单或按钮，实时捕获符合 UIAction 协议规范的回调载荷。
                </p>
              </div>
            ) : (
              actionLogs.map((log, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 space-y-1.5 text-left transition-all"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-indigo-400">
                      [{log.action.componentType || "action"}]
                    </span>
                    <span className="text-neutral-500">{log.timestamp}</span>
                  </div>

                  <pre className="text-[11px] font-mono text-neutral-300 bg-neutral-900/80 p-2 rounded-lg overflow-x-auto custom-scrollbar">
                    {JSON.stringify(log.action, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* 底部紧凑信息栏 */}
      <footer className="shrink-0 pt-2 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-500 mt-2 z-10">
        <span>UI Component Gallery Sandbox</span>
        <span>NestJS (API: 4001) + Next.js 16 (Port: 3002)</span>
      </footer>
    </main>
  );
}
