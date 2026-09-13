"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { ActiveView, ModelConfig, SessionItem } from "./types";
import {
  getStoredModels,
  saveStoredModels,
  getStoredSessions,
  saveStoredSessions,
  getActiveSessionId,
  setActiveSessionId,
  INITIAL_MODELS,
} from "./storage";
import { AppSidebar } from "./AppSidebar";
import { ModelConfigPanel } from "./ModelConfigPanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { ChatWorkspace } from "./ChatWorkspace";

export const WorkbenchLayout: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [models, setModels] = useState<ModelConfig[]>(INITIAL_MODELS);
  const [currentModel, setCurrentModel] = useState<ModelConfig | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string>("");

  // 客户端初次挂载加载本地存储
  useEffect(() => {
    setMounted(true);
    const loadedModels = getStoredModels();
    setModels(loadedModels);
    const defaultModel =
      loadedModels.find((m) => m.isDefault) || loadedModels[0] || null;
    setCurrentModel(defaultModel);

    const loadedSessions = getStoredSessions();
    if (loadedSessions.length > 0) {
      setSessions(loadedSessions);
      const lastActiveId = getActiveSessionId();
      const matched = loadedSessions.find((s) => s.id === lastActiveId);
      if (matched) {
        setActiveSessionIdState(matched.id);
      } else {
        setActiveSessionIdState(loadedSessions[0].id);
        setActiveSessionId(loadedSessions[0].id);
      }
    } else {
      // 自动创建首个新会话
      const initialId = `session-${Date.now()}`;
      const firstSession: SessionItem = {
        id: initialId,
        title: "新对话",
        modelId: defaultModel?.id || "model-gpt-5-4",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSessions([firstSession]);
      saveStoredSessions([firstSession]);
      setActiveSessionIdState(initialId);
      setActiveSessionId(initialId);
    }
  }, []);

  // 新建会话
  const handleNewSession = useCallback(() => {
    const newId = `session-${Date.now()}`;
    const newSession: SessionItem = {
      id: newId,
      title: "新对话",
      modelId: currentModel?.id || "model-gpt-5-4",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const nextSessions = [newSession, ...sessions];
    setSessions(nextSessions);
    saveStoredSessions(nextSessions);
    setActiveSessionIdState(newId);
    setActiveSessionId(newId);
    setActiveView("chat");
  }, [currentModel, sessions]);

  // 切换会话
  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionIdState(id);
    setActiveSessionId(id);
    setActiveView("chat");
  }, []);

  // 删除会话
  const handleDeleteSession = useCallback(
    (id: string) => {
      const nextSessions = sessions.filter((s) => s.id !== id);
      setSessions(nextSessions);
      saveStoredSessions(nextSessions);

      if (activeSessionId === id) {
        if (nextSessions.length > 0) {
          setActiveSessionIdState(nextSessions[0].id);
          setActiveSessionId(nextSessions[0].id);
        } else {
          // 若全清空，新造一个
          const newId = `session-${Date.now()}`;
          const newSession: SessionItem = {
            id: newId,
            title: "新对话",
            modelId: currentModel?.id || "model-gpt-5-4",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setSessions([newSession]);
          saveStoredSessions([newSession]);
          setActiveSessionIdState(newId);
          setActiveSessionId(newId);
        }
      }
    },
    [activeSessionId, currentModel, sessions]
  );

  // 依据用户首条提问更新会话标题
  const handleUpdateSessionTitle = useCallback(
    (sessionId: string, newTitle: string) => {
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.id === sessionId ? { ...s, title: newTitle, updatedAt: Date.now() } : s
        );
        saveStoredSessions(next);
        return next;
      });
    },
    []
  );

  // 保存模型（新增/编辑）
  const handleSaveModel = useCallback(
    (savedModel: ModelConfig) => {
      setModels((prev) => {
        const exists = prev.some((m) => m.id === savedModel.id);
        let updated: ModelConfig[];
        if (exists) {
          updated = prev.map((m) => (m.id === savedModel.id ? savedModel : m));
        } else {
          updated = [...prev, savedModel];
        }
        if (savedModel.isDefault) {
          updated = updated.map((m) => ({
            ...m,
            isDefault: m.id === savedModel.id,
          }));
        }
        saveStoredModels(updated);
        return updated;
      });
    },
    []
  );

  // 删除模型
  const handleDeleteModel = useCallback((id: string) => {
    setModels((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveStoredModels(next);
      return next;
    });
  }, []);

  // 设为默认模型
  const handleSetDefaultModel = useCallback((id: string) => {
    setModels((prev) => {
      const next = prev.map((m) => ({
        ...m,
        isDefault: m.id === id,
      }));
      saveStoredModels(next);
      const def = next.find((m) => m.id === id);
      if (def) setCurrentModel(def);
      return next;
    });
  }, []);

  if (!mounted) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center text-neutral-500 text-xs font-mono">
        Loading Autix AI Studio...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-black text-neutral-100 font-sans selection:bg-blue-600 selection:text-white">
      {/* 左侧侧边栏 (包含品牌、新建会话、资料库、模型配置、RECENTS列表) */}
      <AppSidebar
        activeView={activeView}
        onSelectView={setActiveView}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        modelCount={models.length}
      />

      {/* 右侧主工作区 (依 activeView 动态切换) */}
      <main className="flex-1 h-full min-w-0 flex flex-col relative overflow-hidden bg-[#000000]">
        {activeView === "model-config" ? (
          <ModelConfigPanel
            models={models}
            onSaveModel={handleSaveModel}
            onDeleteModel={handleDeleteModel}
            onSetDefaultModel={handleSetDefaultModel}
          />
        ) : activeView === "knowledge" ? (
          <KnowledgePanel />
        ) : (
          <ChatWorkspace
            key={activeSessionId}
            sessionId={activeSessionId}
            models={models}
            currentModel={currentModel}
            onSelectModel={setCurrentModel}
            onUpdateSessionTitle={handleUpdateSessionTitle}
          />
        )}
      </main>
    </div>
  );
};
