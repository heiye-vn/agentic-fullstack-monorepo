'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Coins,
  AlertTriangle,
  ChevronDown,
  Zap,
  ShieldCheck,
  Activity,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import type { TokenUsageMeta } from '@/types/ai-ui';

export interface SessionTokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  rounds: number;
}

export interface TokenCostBadgeProps {
  /** 本轮 Token 消耗 */
  currentUsage: TokenUsageMeta | null;
  /** 当前生效模型名称 */
  modelName: string | null;
  /** 密钥来源 */
  keySource: 'db' | 'env' | 'default' | 'none' | null;
  /** 模型覆盖/降级原因 */
  overrideReason?: string | null;
  /** 会话累计统计 */
  sessionStats?: SessionTokenStats | null;
}

// 汇率常数：对齐第十章教程中 1 USD ≈ 7.2 RMB
const USD_TO_RMB_RATE = 7.2;

/**
 * 格式化 Token 数量
 */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(2)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toLocaleString();
}

/**
 * 格式化美元金额（极小金额保留 4-6 位小数）
 */
function formatUsdCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.0001) return `<$0.0001`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/**
 * 格式化人民币金额
 */
function formatRmbCost(costUsd: number): string {
  const rmb = costUsd * USD_TO_RMB_RATE;
  if (rmb === 0) return '¥0.00';
  if (rmb < 0.001) return `<¥0.001`;
  if (rmb < 0.01) return `¥${rmb.toFixed(4)}`;
  return `¥${rmb.toFixed(3)}`;
}

/**
 * 将 overrideReason 转换为中文友好文案与描述
 */
function parseOverrideReason(reason?: string | null): { title: string; desc: string } | null {
  if (!reason) return null;

  if (reason.includes('budget_tight_downgrade')) {
    return {
      title: '预算紧张触发降级',
      desc: '当月预算使用率处于 80%~100% 警戒区间，非核心专家已自动降级至高性价比模型以节约成本。',
    };
  }
  if (reason.includes('budget_exceeded_reject')) {
    return {
      title: '预算超限告警',
      desc: '月度预算已 100% 耗尽，除轻量对话压缩工具外其余高成本调用已被限制。',
    };
  }
  if (reason.includes('low_complexity_downgrade')) {
    return {
      title: '低复杂度智能降级',
      desc: '识别为简单单步需求，无需调度重型旗舰模型，已自动分配低成本模型。',
    };
  }
  if (reason.includes('compressor')) {
    return {
      title: '压缩治理豁免',
      desc: '当前执行长会话上下文摘要压缩，专享降本治理豁免通道。',
    };
  }

  return {
    title: '模型路由策略覆盖',
    desc: `策略响应原因: ${reason}`,
  };
}

export function TokenCostBadge({
  currentUsage,
  modelName,
  keySource,
  overrideReason,
  sessionStats,
}: TokenCostBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭弹窗
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // 按 Esc 键关闭
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // 若本轮与会话均无任何消耗，优雅展示默认健康态指示
  const hasUsage = currentUsage && currentUsage.totalTokens > 0;
  const isDowngraded = Boolean(overrideReason);
  const downgradeInfo = parseOverrideReason(overrideReason);

  const displayTokens = currentUsage?.totalTokens ?? sessionStats?.totalTokens ?? 0;
  const displayCostUsd = currentUsage?.estimatedCostUsd ?? sessionStats?.totalCostUsd ?? 0;

  return (
    <div ref={ref} className="relative inline-flex items-center">
      {/* 状态栏触发按钮 */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer"
        style={{
          backgroundColor: open
            ? 'var(--surface)'
            : isDowngraded
            ? 'color-mix(in srgb, #f59e0b 12%, transparent)'
            : 'var(--panel)',
          color: isDowngraded ? '#d97706' : 'var(--foreground)',
          border: `1px solid ${
            isDowngraded ? 'color-mix(in srgb, #f59e0b 40%, var(--border))' : 'var(--border)'
          }`,
        }}
        title="点击查看本轮与累计 Token 消耗及成本治理详情"
      >
        {isDowngraded ? (
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 animate-pulse" />
        ) : (
          <Coins className="w-3.5 h-3.5 shrink-0 text-amber-500/90" />
        )}

        <div className="flex items-center gap-1 tabular-nums">
          <span className="font-semibold tracking-tight">
            {displayTokens > 0 ? formatTokenCount(displayTokens) : '0'}
          </span>
          <span className="text-[10.5px] opacity-60">tokens</span>
          <span className="opacity-40">·</span>
          <span className="font-medium opacity-90">{formatUsdCost(displayCostUsd)}</span>
        </div>

        {isDowngraded && (
          <span className="ml-0.5 rounded px-1 py-0.2 text-[10px] font-semibold uppercase bg-amber-500/20 text-amber-600 dark:text-amber-400">
            已降级
          </span>
        )}

        <ChevronDown
          className="w-3 h-3 transition-transform duration-200 shrink-0 opacity-60"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* 浮窗详情卡片 (Popover) */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-85 sm:w-95 rounded-2xl p-4 z-50 shadow-2xl backdrop-blur-md transition-all duration-200"
          style={{
            backgroundColor: 'var(--overlay)',
            border: '1px solid var(--border)',
            boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* 卡片头部 */}
          <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Coins className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
                  Token 经济学与成本治理
                </h4>
                <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  第十章生产级成本度量与动态熔断
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              style={{ color: 'var(--foreground)' }}
              title="关闭面板"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 降级状态提示横幅（若存在） */}
          {isDowngraded && downgradeInfo && (
            <div
              className="mt-3 rounded-xl p-2.5 flex items-start gap-2 text-xs"
              style={{
                backgroundColor: 'color-mix(in srgb, #f59e0b 10%, transparent)',
                border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-amber-600 dark:text-amber-400">
                  {downgradeInfo.title}
                </div>
                <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                  {downgradeInfo.desc}
                </div>
              </div>
            </div>
          )}

          {/* 数据指标两栏卡片：本轮消耗 */}
          <div className="mt-3.5">
            <div className="flex items-center justify-between text-[11px] font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" /> 本轮对话消耗
              </span>
              {currentUsage?.isEstimated && (
                <span className="text-[10px] opacity-70">（实时动态估算）</span>
              )}
            </div>

            <div
              className="grid grid-cols-2 gap-2 p-2.5 rounded-xl"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {/* 总 Tokens */}
              <div>
                <span className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                  本轮总计 Tokens
                </span>
                <div className="text-base font-bold tabular-nums mt-0.5" style={{ color: 'var(--foreground)' }}>
                  {hasUsage ? currentUsage.totalTokens.toLocaleString() : '0'}
                </div>
                <div className="text-[10px] mt-0.5 flex gap-2 tabular-nums" style={{ color: 'var(--muted)' }}>
                  <span>入: {currentUsage?.inputTokens.toLocaleString() ?? 0}</span>
                  <span>出: {currentUsage?.outputTokens.toLocaleString() ?? 0}</span>
                </div>
              </div>

              {/* 预估成本 */}
              <div>
                <span className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                  预估费用 (USD / RMB)
                </span>
                <div className="text-base font-bold tabular-nums mt-0.5" style={{ color: 'var(--foreground)' }}>
                  {formatUsdCost(currentUsage?.estimatedCostUsd ?? 0)}
                </div>
                <div className="text-[10.5px] mt-0.5 font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                  ≈ {formatRmbCost(currentUsage?.estimatedCostUsd ?? 0)}
                </div>
              </div>
            </div>
          </div>

          {/* 生效模型与计费费率 */}
          <div
            className="mt-2.5 rounded-xl p-2.5 text-xs flex flex-col gap-1.5"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                <Zap className="w-3 h-3" /> 生效模型
              </span>
              <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                {modelName ?? '系统默认'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                密钥授权来源
              </span>
              <span className="text-[11px] font-medium" style={{ color: 'var(--foreground)' }}>
                {keySource === 'db'
                  ? '数据库加密凭据 (私有)'
                  : keySource === 'env'
                  ? '服务端环境凭据 (系统)'
                  : keySource === 'none'
                  ? '确定性状态机 (免模型)'
                  : '默认配置'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                <ShieldCheck className="w-3 h-3 text-emerald-500" /> 治理保护
              </span>
              <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400 font-medium">
                {isDowngraded ? '高风险角色受保 · 次要专家已降级' : '全专家链路健康就绪'}
              </span>
            </div>
          </div>

          {/* 会话累计看板 */}
          {sessionStats && sessionStats.rounds > 0 && (
            <div
              className="mt-2.5 rounded-xl p-2.5 text-xs flex items-center justify-between"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
              }}
            >
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-medium" style={{ color: 'var(--foreground)' }}>
                  会话累计 ({sessionStats.rounds} 轮交互)
                </span>
              </div>
              <div className="text-right tabular-nums">
                <span className="font-semibold text-xs" style={{ color: 'var(--foreground)' }}>
                  {formatTokenCount(sessionStats.totalTokens)} tokens
                </span>
                <span className="mx-1 opacity-50">·</span>
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {formatUsdCost(sessionStats.totalCostUsd)}
                </span>
              </div>
            </div>
          )}

          {/* 底部说明 */}
          <div className="mt-3 pt-2 text-center text-[10px]" style={{ color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
            <span className="flex items-center justify-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500/80" />
              遵循无侵入侧路统计 · 实际计费请以模型供应商后台账单为准
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
