"use client";

import React, { useState } from "react";
import type { ModelCapability, ModelConfig } from "./types";

interface ModelConfigPanelProps {
  models: ModelConfig[];
  onSaveModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSetDefaultModel: (id: string) => void;
}

const ALL_CAPABILITIES: { key: ModelCapability; label: string }[] = [
  { key: "text", label: "text" },
  { key: "vision", label: "vision" },
  { key: "voice", label: "voice" },
  { key: "speech", label: "speech" },
  { key: "code", label: "code" },
  { key: "reasoning", label: "reasoning" },
  { key: "image", label: "image" },
  { key: "embedding", label: "embedding" },
];

export const ModelConfigPanel: React.FC<ModelConfigPanelProps> = ({
  models,
  onSaveModel,
  onDeleteModel,
  onSetDefaultModel,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("dashscope");
  const [formModelName, setFormModelName] = useState("qwen3.8-max");
  const [formType, setFormType] = useState("general");
  const [formPriority, setFormPriority] = useState<number>(0);
  const [formVisibility, setFormVisibility] = useState<"private" | "public">("private");
  const [formBaseUrl, setFormBaseUrl] = useState("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [formApiKey, setFormApiKey] = useState("");
  const [formTemperature, setFormTemperature] = useState<number>(0);
  const [formMaxTokens, setFormMaxTokens] = useState<number>(2048);
  const [formIsDefault, setFormIsDefault] = useState<boolean>(false);
  const [formCapabilities, setFormCapabilities] = useState<ModelCapability[]>(["text", "code", "reasoning"]);

  // 重置表单
  const resetForm = () => {
    setEditingId(null);
    setFormName("");
    setFormProvider("dashscope");
    setFormModelName("qwen3.8-max");
    setFormType("general");
    setFormPriority(0);
    setFormVisibility("private");
    setFormBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
    setFormApiKey("");
    setFormTemperature(0);
    setFormMaxTokens(2048);
    setFormIsDefault(false);
    setFormCapabilities(["text", "code", "reasoning"]);
  };

  // 触发编辑
  const handleStartEdit = (m: ModelConfig) => {
    setEditingId(m.id);
    setFormName(m.name);
    setFormProvider(m.provider);
    setFormModelName(m.modelName);
    setFormType(m.type);
    setFormPriority(m.priority);
    setFormVisibility(m.visibility);
    setFormBaseUrl(m.baseUrl);
    setFormApiKey(m.apiKey || "");
    setFormTemperature(m.temperature);
    setFormMaxTokens(m.maxTokens);
    setFormIsDefault(m.isDefault);
    setFormCapabilities(m.capabilities);
  };

  // 切换标签
  const toggleCapability = (cap: ModelCapability) => {
    if (formCapabilities.includes(cap)) {
      if (formCapabilities.length > 1) {
        setFormCapabilities(formCapabilities.filter((c) => c !== cap));
      }
    } else {
      setFormCapabilities([...formCapabilities, cap]);
    }
  };

  // 提交保存
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalModel: ModelConfig = {
      id: editingId || `model-${Date.now()}`,
      name: formName.trim() || formModelName.trim() || "新模型",
      provider: formProvider.trim() || "openai",
      modelName: formModelName.trim() || "gpt-4o",
      type: formType,
      priority: Number(formPriority) || 0,
      visibility: formVisibility,
      baseUrl: formBaseUrl.trim() || "https://api.openai.com/v1",
      apiKey: formApiKey.trim(),
      temperature: Number(formTemperature) || 0.7,
      maxTokens: Number(formMaxTokens) || 2048,
      isDefault: formIsDefault,
      capabilities: formCapabilities,
    };

    onSaveModel(finalModel);
    resetForm();
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0a0a0a] text-neutral-200 p-6 md:p-8 space-y-6 custom-scrollbar">
      {/* 顶部面包屑/标题 */}
      <div className="flex items-center gap-2 text-sm text-neutral-400 font-medium">
        <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-white font-semibold">模型配置</span>
        <span className="text-xs text-neutral-500 font-mono ml-0.5">{models.length}</span>
      </div>

      {/* 新增/编辑模型 卡片表单 */}
      <div className="w-full max-w-4xl rounded-2xl bg-[#111111] border border-neutral-800/90 p-6 shadow-xl relative">
        <div className="flex items-center justify-between pb-5 border-b border-neutral-800/60">
          <h2 className="text-sm font-semibold text-white">
            {editingId ? "编辑模型" : "新增模型"}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-neutral-400 hover:text-white transition cursor-pointer p-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* 两列字段网格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 名称 */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">名称</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如：通义千问 3.7"
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* 供应商 */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">供应商</label>
              <input
                type="text"
                value={formProvider}
                onChange={(e) => setFormProvider(e.target.value)}
                placeholder="dashscope"
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* 模型名称 */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">模型名称</label>
              <input
                type="text"
                value={formModelName}
                onChange={(e) => setFormModelName(e.target.value)}
                placeholder="qwen3.7-flash"
                required
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* 类型 */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">类型</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600 transition"
              >
                <option value="general">general</option>
                <option value="chat">chat</option>
                <option value="reasoning">reasoning</option>
              </select>
            </div>

            {/* 优先级 */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">优先级</label>
              <input
                type="number"
                value={formPriority}
                onChange={(e) => setFormPriority(Number(e.target.value))}
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* 可见性 */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">可见性</label>
              <select
                value={formVisibility}
                onChange={(e) => setFormVisibility(e.target.value as "private" | "public")}
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600 transition"
              >
                <option value="private">私人</option>
                <option value="public">公开</option>
              </select>
            </div>

            {/* Base URL */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">Base URL</label>
              <input
                type="text"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                placeholder="https://api.amux.ai/v1"
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* API Key */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">API Key</label>
              <input
                type="password"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="sk-... (可选)"
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* Temperature */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">Temperature</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formTemperature}
                onChange={(e) => setFormTemperature(Number(e.target.value))}
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600 transition"
              />
            </div>

            {/* Max Tokens */}
            <div className="flex items-center gap-3">
              <label className="w-20 shrink-0 text-xs text-neutral-400">Max Tokens</label>
              <input
                type="number"
                value={formMaxTokens}
                onChange={(e) => setFormMaxTokens(Number(e.target.value))}
                className="flex-1 bg-neutral-900/90 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600 transition"
              />
            </div>
          </div>

          {/* 设为默认 */}
          <div className="flex items-center gap-3 pt-2">
            <label className="w-20 shrink-0 text-xs text-neutral-400">设为默认</label>
            <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={(e) => setFormIsDefault(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 focus:ring-offset-0"
              />
              <span>设为默认模型</span>
            </label>
          </div>

          {/* 能力标签 */}
          <div className="flex items-start gap-3 pt-2">
            <label className="w-20 shrink-0 text-xs text-neutral-400 pt-1">能力标签</label>
            <div className="flex flex-wrap gap-2">
              {ALL_CAPABILITIES.map((cap) => {
                const isSelected = formCapabilities.includes(cap.key);
                return (
                  <button
                    key={cap.key}
                    type="button"
                    onClick={() => toggleCapability(cap.key)}
                    className={`px-3 py-1 rounded-full text-xs font-mono transition cursor-pointer ${
                      isSelected
                        ? "bg-blue-600 text-white font-medium shadow-[0_0_10px_rgba(37,99,235,0.4)]"
                        : "bg-neutral-900 text-neutral-400 border border-neutral-800 hover:border-neutral-700 hover:text-white"
                    }`}
                  >
                    {cap.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 操作栏 */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800/60">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-1.5 rounded-xl text-xs text-neutral-400 hover:text-white transition cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_12px_rgba(37,99,235,0.35)] transition cursor-pointer"
            >
              {editingId ? "保存修改" : "创建"}
            </button>
          </div>
        </form>
      </div>

      {/* 下方：私人模型列表 */}
      <div className="w-full max-w-4xl space-y-3 pt-2">
        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          私人模型
        </h3>

        <div className="space-y-2.5">
          {models.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl bg-[#111111] border border-neutral-800/80 p-4 flex items-center justify-between hover:border-neutral-700 transition shadow-sm"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white tracking-tight">
                    {m.name}
                  </span>
                  {m.isDefault && (
                    <span className="px-1.5 py-0.2 rounded-md bg-neutral-800 border border-neutral-700 text-[10px] text-neutral-300">
                      默认
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-400">
                  {m.modelName} · {m.provider}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {m.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 rounded-md bg-neutral-900 text-neutral-400 text-[11px] font-mono border border-neutral-800/60"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              {/* 右侧编辑与删除操作 */}
              <div className="flex items-center gap-2">
                {!m.isDefault && (
                  <button
                    type="button"
                    onClick={() => onSetDefaultModel(m.id)}
                    className="text-xs text-neutral-400 hover:text-white px-2 py-1 rounded-lg hover:bg-neutral-800 transition cursor-pointer"
                  >
                    设为默认
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleStartEdit(m)}
                  title="编辑模型"
                  className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteModel(m.id)}
                  title="删除模型"
                  disabled={models.length <= 1}
                  className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
