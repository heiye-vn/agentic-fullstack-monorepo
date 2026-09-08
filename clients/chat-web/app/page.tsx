"use client";

import { useState, useCallback } from "react";
import { APP_NAME, type RequirementResult } from "@autix/contracts";

const DEFAULT_REQUIREMENT = "用户注册时必须绑定手机号，密码至少8位";

const PRESET_EXAMPLES = [
  {
    label: "注册约束 (默认)",
    text: "用户注册时必须绑定手机号，密码至少8位",
  },
  {
    label: "报表导出",
    text: "导出报表时必须包含操作日志，单次导出不能超过1000条",
  },
  {
    label: "退款审核",
    text: "订单退款必须在7天内申请，且已消费金额不能申请退款",
  },
];

export default function Home() {
  const [input, setInput] = useState(DEFAULT_REQUIREMENT);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RequirementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4001";

  const handleCheckHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const res = await fetch(`${apiBaseUrl}/health`);
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean };
        setHealthStatus(data.ok ? "在线 (200 OK)" : "异常");
      } else {
        setHealthStatus(`异常 (${res.status})`);
      }
    } catch {
      setHealthStatus("离线 (服务未启动)");
    } finally {
      setCheckingHealth(false);
    }
  }, [apiBaseUrl]);

  const handleSubmit = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || loading) return;

    setLoading(true);
    setError(null);
    const startTime = performance.now();

    try {
      const res = await fetch(`${apiBaseUrl}/requirement/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: trimmedInput }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `服务端响应异常 (${res.status}): ${errText || res.statusText}`,
        );
      }

      const data = (await res.json()) as RequirementResult;
      setResult(data);
      setLatency(Math.round(performance.now() - startTime));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 容错处理
    }
  };

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#000000] text-neutral-100 flex flex-col p-4 md:p-6 selection:bg-white selection:text-black relative font-sans">
      {/* 顶部微弱冷光雾化 (Linear / Vercel 极简曜石质感) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04)_0%,transparent_70%)] pointer-events-none" />

      {/* 顶部全局导航栏 */}
      <header className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-neutral-800/80 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-neutral-900 border border-neutral-700/60 flex items-center justify-center text-white shadow-sm">
            <svg
              className="w-4 h-4 text-neutral-200"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                需求结构化抽取平台
              </h1>
              <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-900 text-neutral-300 border border-neutral-800">
                LangChain Structured Output
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-neutral-400">
              Nest 服务端模型契约绑定 ➔ 动作、约束条件与名词实体精准解析
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          <button
            type="button"
            id="check-health-btn"
            onClick={handleCheckHealth}
            disabled={checkingHealth}
            title="点击刷新后端服务健康状态"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                healthStatus?.includes("在线")
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                  : healthStatus
                  ? "bg-amber-400"
                  : "bg-neutral-500"
              }`}
            />
            Nest: {checkingHealth ? "探测中..." : healthStatus || "探测健康状态"}
          </button>

          <span
            id="app-name-badge"
            className="font-mono text-xs font-medium text-neutral-300 bg-neutral-900 px-2.5 py-1 rounded-md border border-neutral-800"
          >
            APP: {APP_NAME}
          </span>
        </div>
      </header>

      {/* 核心工作区：左右双栏极客工作台 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4 z-10">
        {/* 左栏：输入与控制面板 (5 列) */}
        <section className="lg:col-span-5 flex flex-col h-full bg-[#0a0a0a] border border-neutral-800/80 rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden">
          <div className="flex-shrink-0 space-y-2.5 pb-2.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="requirement-input"
                className="text-xs sm:text-sm font-medium text-neutral-200 flex items-center gap-1.5"
              >
                <svg
                  className="w-3.5 h-3.5 text-neutral-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                业务需求描述 (Input)
              </label>

              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setInput(DEFAULT_REQUIREMENT)}
                  className="text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                >
                  恢复默认
                </button>
                <span className="text-neutral-700">|</span>
                <button
                  type="button"
                  onClick={() => setInput("")}
                  className="text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
                >
                  清空
                </button>
              </div>
            </div>

            {/* 预设示例快速切换标签 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-500">示例：</span>
              {PRESET_EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => setInput(example.text)}
                  className={`text-xs px-2 py-0.5 rounded-md transition-all cursor-pointer border ${
                    input === example.text
                      ? "bg-neutral-800 text-white border-neutral-600 font-medium"
                      : "bg-[#111111] text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200"
                  }`}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>

          {/* 多行输入框 */}
          <div className="flex-1 min-h-0 relative flex flex-col pt-1">
            <textarea
              id="requirement-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入需要提取的业务需求描述，例如：用户注册时必须绑定手机号，密码至少8位..."
              className="w-full h-full bg-[#000000] border border-neutral-800/90 rounded-xl p-3.5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-all leading-relaxed resize-none custom-scrollbar"
            />
            <div className="absolute bottom-3 right-3 text-[11px] text-neutral-500 pointer-events-none select-none bg-[#0a0a0a] px-2 py-0.5 rounded border border-neutral-800">
              {input.length} 字
            </div>
          </div>

          {/* 底部提交栏 */}
          <div className="flex-shrink-0 flex items-center justify-between gap-3 pt-3 border-t border-neutral-800/80 mt-3">
            <span className="text-xs text-neutral-500">
              快捷键：<kbd className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 font-mono text-[11px]">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 font-mono text-[11px]">Enter</kbd>
            </span>

            {/* Linear / Vercel 签名白底高亮按钮 */}
            <button
              id="submit-extract-btn"
              type="button"
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="px-5 py-2 rounded-lg font-semibold text-xs sm:text-sm transition-all duration-150 cursor-pointer bg-white text-black hover:bg-neutral-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-3.5 w-3.5 text-black"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  <span>抽取中...</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <span>提交抽取需求</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* 右栏：结果展示与 JSON 容器 (7 列，仅内部滚动) */}
        <section className="lg:col-span-7 flex flex-col h-full bg-[#0a0a0a] border border-neutral-800/80 rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden">
          {/* 标题控制栏 */}
          <div className="flex-shrink-0 flex items-center justify-between pb-3 border-b border-neutral-800/80 mb-3">
            <h2 className="text-xs sm:text-sm font-medium text-neutral-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
              抽取结果展示 (JSON Result)
            </h2>

            <div className="flex items-center gap-2">
              {latency !== null && (
                <span className="text-xs font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                  {latency}ms
                </span>
              )}

              {result && (
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="px-2.5 py-1 text-xs rounded-md bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <svg
                        className="w-3.5 h-3.5 text-emerald-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-emerald-300 font-medium">已复制</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-3.5 h-3.5 text-neutral-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      <span>复制 JSON</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* 独立可滚动结果容器 (只在此区域滚动，避免全局滚动条) */}
          <div
            id="json-result-container"
            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-3.5"
          >
            {/* 错误提示 */}
            {error && (
              <div
                id="error-message"
                className="p-3.5 bg-rose-950/20 border border-rose-800/40 rounded-xl text-rose-300 text-xs space-y-1"
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <svg
                    className="w-3.5 h-3.5 text-rose-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  请求失败
                </div>
                <p className="font-mono text-xs opacity-90 break-all">{error}</p>
              </div>
            )}

            {result ? (
              <div className="space-y-3.5">
                {/* 语义化标签卡片 */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 bg-[#111111] border border-neutral-800/90 rounded-xl space-y-1">
                    <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
                      核心动作 (Action)
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-white block truncate">
                      {result.action || "无"}
                    </span>
                  </div>

                  <div className="p-3 bg-[#111111] border border-neutral-800/90 rounded-xl space-y-1.5">
                    <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
                      约束条件 ({result.constraints?.length ?? 0})
                    </span>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                      {result.constraints?.length ? (
                        result.constraints.map((c, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] px-2 py-0.5 rounded bg-neutral-900 text-neutral-200 border border-neutral-700/80 font-mono"
                          >
                            {c}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-neutral-500">无约束</span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-[#111111] border border-neutral-800/90 rounded-xl space-y-1.5">
                    <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
                      实体名词 ({result.entities?.length ?? 0})
                    </span>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                      {result.entities?.length ? (
                        result.entities.map((e, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] px-2 py-0.5 rounded bg-neutral-900 text-neutral-200 border border-neutral-700/80 font-mono"
                          >
                            {e}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-neutral-500">无实体</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 原始 JSON 高亮代码框 */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-neutral-500 block">
                    RequirementResult JSON (标准契约输出)
                  </span>
                  <pre
                    id="json-output"
                    className="p-4 bg-[#000000] rounded-xl border border-neutral-800/90 font-mono text-xs sm:text-sm text-neutral-200 overflow-x-auto custom-scrollbar leading-relaxed"
                  >
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center p-6 text-neutral-500 space-y-2.5">
                <div className="w-12 h-12 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500">
                  <svg
                    className="w-6 h-6 stroke-[1.5]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </div>
                <div className="space-y-1 max-w-sm">
                  <p className="text-xs sm:text-sm font-medium text-neutral-300">
                    等待执行需求抽取
                  </p>
                  <p className="text-xs text-neutral-500">
                    在左侧输入需求描述后点击“提交抽取需求”，结果将在此处实时呈现。
                  </p>
                </div>
                <p className="text-[11px] text-neutral-600 font-mono bg-[#111111] px-2.5 py-1 rounded border border-neutral-800">
                  POST /requirement/extract ➔ Promise&lt;RequirementResult&gt;
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 底部紧凑信息栏 */}
      <footer className="flex-shrink-0 pt-3 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-500 mt-3 z-10">
        <span>Monorepo: Turborepo + pnpm</span>
        <span>NestJS (API: 4001) + Next.js 16 (Port: 3002)</span>
      </footer>
    </main>
  );
}
