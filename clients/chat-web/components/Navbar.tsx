"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_CHAT_API_URL || "http://localhost:4001";

  const handleCheckHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const res = await fetch(`${apiBaseUrl}/health`);
      if (res.ok) {
        const resJson = (await res.json()) as {
          ok?: boolean;
          success?: boolean;
          data?: { ok?: boolean };
        };
        const isHealthy = Boolean(
          resJson.ok ?? resJson.data?.ok ?? resJson.success
        );
        setHealthStatus(isHealthy ? "在线 (200 OK)" : "异常");
      } else {
        setHealthStatus(`异常 (${res.status})`);
      }
    } catch {
      setHealthStatus("离线 (服务未启动)");
    } finally {
      setCheckingHealth(false);
    }
  }, [apiBaseUrl]);

  const navItems = [
    { label: "AI 助手", href: "/" },
    { label: "课程工作台", href: "/labs" },
    { label: "需求结构化抽取", href: "/extract" },
    { label: "AI 交互工作流", href: "/ui-chat" },
    { label: "UI 组件展厅", href: "/ui-gallery" },
  ];

  return (
    <header className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-neutral-800/80 z-20">
      {/* 平台标识与品牌 */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="w-8 h-8 rounded-lg bg-neutral-900 border border-neutral-700/60 flex items-center justify-center text-white shadow-sm hover:border-neutral-500 transition-colors"
        >
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
        </Link>

        <div>
          <div className="flex items-center gap-2.5">
            <Link href="/" className="text-base sm:text-lg font-bold text-white tracking-tight hover:text-neutral-200 transition">
              AI 需求智能架构平台
            </Link>
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-900 text-neutral-300 border border-neutral-800">
              LangChain + NestJS
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-neutral-400">
            UI Protocol 协议式组件渲染 ➔ 结构化抽取、动态表单与自适应状态机
          </p>
        </div>
      </div>

      {/* 路由导航胶囊与健康检测 */}
      <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
        <nav className="flex items-center rounded-lg border border-neutral-800 bg-neutral-950/80 p-1 text-xs">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  isActive
                    ? "bg-neutral-800 text-white font-medium shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 健康状态检测按钮 */}
        <button
          type="button"
          id="check-health-btn"
          onClick={handleCheckHealth}
          disabled={checkingHealth}
          title="点击刷新后端服务健康状态"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
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
          <span>{checkingHealth ? "检测中..." : healthStatus || "后端: 探测服务状态"}</span>
        </button>
      </div>
    </header>
  );
};
