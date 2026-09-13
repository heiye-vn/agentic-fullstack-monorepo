"use client";

import React from "react";
import { Navbar } from "@/components/Navbar";
import { AIChatContainer } from "@/components/ai-ui/AIChatContainer";

export default function UIChatPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#000000] text-neutral-100 flex flex-col p-4 md:p-6 selection:bg-white selection:text-black relative font-sans">
      {/* 顶部微弱冷光雾化 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-200 h-75 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04)_0%,transparent_70%)] pointer-events-none" />

      {/* 统一全局导航栏 */}
      <Navbar />

      {/* 核心 AI 对话交互工作区 */}
      <div className="flex-1 min-h-0 py-3 z-10">
        <AIChatContainer />
      </div>

      {/* 底部紧凑信息栏 */}
      <footer className="shrink-0 pt-2 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-500 mt-2 z-10">
        <span>AI UI Protocol: /api/ui-chat/chat & /api/ui-chat/action</span>
        <span>NestJS (API: 4001) + Next.js 16 (Port: 3002)</span>
      </footer>
    </main>
  );
}
