"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { ActiveView, SessionItem } from "./types";

interface AppSidebarProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  modelCount: number;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  activeView,
  onSelectView,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  modelCount,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-64 shrink-0 bg-[#000000] border-r border-neutral-800/80 flex flex-col h-full select-none text-neutral-300">
      {/* 顶部品牌 */}
      <div className="h-14 px-4 flex items-center gap-2.5 border-b border-neutral-900">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-[0_0_12px_rgba(99,102,241,0.35)]">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span className="font-semibold text-white tracking-tight text-sm">Autix AI</span>
      </div>

      {/* 顶部新建按钮与主菜单 */}
      <div className="p-3 space-y-2">
        {/* 新建会话按钮 */}
        <button
          type="button"
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-white text-xs font-medium border border-neutral-800 hover:border-neutral-700 transition cursor-pointer shadow-sm group"
        >
          <svg className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          <span>新建会话</span>
        </button>

        {/* 导航菜单 */}
        <div className="space-y-0.5 pt-1">
          {/* 资料库 */}
          <button
            type="button"
            onClick={() => onSelectView("knowledge")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
              activeView === "knowledge"
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:text-white hover:bg-neutral-900/60"
            }`}
          >
            <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>资料库</span>
          </button>

          {/* 模型配置 */}
          <button
            type="button"
            onClick={() => onSelectView("model-config")}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
              activeView === "model-config"
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:text-white hover:bg-neutral-900/60"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>模型配置</span>
            </div>
            {modelCount > 0 && (
              <span className="text-[10px] text-neutral-400 font-mono px-1.5 py-0.2 rounded-full bg-neutral-900 border border-neutral-800">
                {modelCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 历史会话列表分组 */}
      <div className="flex-1 flex flex-col min-h-0 px-3 pt-2">
        <div className="flex items-center justify-between px-2 pb-2 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
          <span>Recents</span>
          <button
            type="button"
            onClick={() => setShowSearch(!showSearch)}
            className="hover:text-neutral-300 transition cursor-pointer"
            title="搜索历史会话"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>

        {/* 展开搜索框 */}
        {showSearch && (
          <div className="mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话..."
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
            />
          </div>
        )}

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pr-0.5">
          {filteredSessions.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-neutral-600">
              暂无历史会话
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isActive = activeView === "chat" && activeSessionId === session.id;

              return (
                <div
                  key={session.id}
                  className={`group relative flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                    isActive
                      ? "bg-neutral-800/90 text-white font-medium shadow-sm"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60"
                  }`}
                  onClick={() => {
                    onSelectView("chat");
                    onSelectSession(session.id);
                  }}
                >
                  <div className="flex items-center gap-2 truncate pr-6">
                    <svg className="w-3.5 h-3.5 shrink-0 text-neutral-500 group-hover:text-neutral-300 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="truncate">{session.title || "新对话"}</span>
                  </div>

                  {/* 删除会话按钮 */}
                  <button
                    type="button"
                    title="删除此会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部功能扩展栏（保留原有功能快捷入口，实现完全平滑兼容） */}
      <div className="p-3 border-t border-neutral-900 text-[11px] space-y-1">
        <div className="text-neutral-500 font-medium px-2 pb-1">快捷工具箱</div>
        <Link
          href="/extract"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-900/60 transition"
        >
          <span>⚡</span>
          <span>需求结构化抽取测试</span>
        </Link>
        <Link
          href="/ui-gallery"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-900/60 transition"
        >
          <span>🎨</span>
          <span>UI 组件协议展厅</span>
        </Link>
      </div>
    </aside>
  );
};
