"use client";

import { useState } from "react";
import { APP_NAME } from "@autix/contracts";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [responseMessage, setResponseMessage] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4001";

  const handleFetchHello = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/hello`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = (await res.json()) as { message: string };
      setResponseMessage(data.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`请求失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckHealth = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/health`);
      const data = (await res.json()) as { ok: boolean };
      setHealthStatus(data.ok ? "Healthy (200 OK)" : "Unhealthy");
    } catch {
      setHealthStatus("Service Offline");
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white/10 backdrop-blur-xl border border-white/15 rounded-3xl p-8 shadow-2xl transition-all duration-300">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
          <div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Monorepo Workspaces
            </span>
            <h1 className="text-2xl font-bold mt-2 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              Autix Chat Web
            </h1>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 block">共享 APP_NAME</span>
            <span
              id="app-name-badge"
              className="text-lg font-mono font-bold text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-lg border border-amber-400/20 inline-block mt-0.5"
            >
              {APP_NAME}
            </span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900/60 rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                后端目标服务
              </span>
              <button
                id="check-health-btn"
                onClick={handleCheckHealth}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
              >
                检查健康状态
              </button>
            </div>
            <p className="font-mono text-xs text-slate-300 break-all">
              {apiBaseUrl}
            </p>
            {healthStatus && (
              <p className="text-xs mt-2 text-emerald-400 flex items-center gap-1.5 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {healthStatus}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button
              id="call-chat-btn"
              onClick={handleFetchHello}
              disabled={loading}
              className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-200 cursor-pointer shadow-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-white"
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
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    ></path>
                  </svg>
                  正在请求 Chat 服务...
                </>
              ) : (
                "调用 Chat 服务 (GET /hello)"
              )}
            </button>
          </div>

          <div className="min-h-[100px] rounded-2xl bg-black/40 border border-white/10 p-5 flex flex-col justify-center">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1 block">
              服务响应数据
            </span>
            {responseMessage ? (
              <div
                id="response-message"
                className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 font-mono text-sm leading-relaxed"
              >
                {responseMessage}
              </div>
            ) : error ? (
              <div
                id="error-message"
                className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 font-mono text-sm"
              >
                {error}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">
                点击上方按钮请求后端 `/hello` 接口
              </p>
            )}
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
          <span>pnpm workspaces</span>
          <span>Turbo + Next.js + NestJS</span>
        </div>
      </div>
    </main>
  );
}
