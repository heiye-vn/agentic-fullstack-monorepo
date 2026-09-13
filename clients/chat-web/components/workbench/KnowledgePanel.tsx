"use client";

import React from "react";

export const KnowledgePanel: React.FC = () => {
  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0a0a0a] text-neutral-200 p-6 md:p-8 space-y-6 custom-scrollbar">
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 text-sm text-neutral-400 font-medium">
        <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <span className="text-white font-semibold">资料库 (RAG 知识库)</span>
      </div>

      <div className="w-full max-w-4xl rounded-2xl bg-[#111111] border border-neutral-800/90 p-8 shadow-xl text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-white">
          企业级文档向量与切块检索
        </h3>
        <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
          基于 PostgreSQL pgvector 与 LangChain 向量检索管道，支持 PDF、Markdown、Excel 智能切分与高维特征嵌入。
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-md transition cursor-pointer"
          >
            + 上传新文档
          </button>
        </div>
      </div>
    </div>
  );
};
