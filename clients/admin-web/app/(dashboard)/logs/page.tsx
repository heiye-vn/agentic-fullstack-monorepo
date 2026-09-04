'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Code2,
  Globe,
  Eye,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { LoginLog, OperationLog, PaginatedResult } from '@/types/auth';
import { RightDrawer } from '@/components/common/right-drawer';

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'OPERATION'>('LOGIN');

  // 登录日志状态
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loginTotal, setLoginTotal] = useState(0);
  const [loginPage, setLoginPage] = useState(1);
  const [loginLoading, setLoginLoading] = useState(false);

  // 操作日志状态
  const [opLogs, setOpLogs] = useState<OperationLog[]>([]);
  const [opTotal, setOpTotal] = useState(0);
  const [opPage, setOpPage] = useState(1);
  const [opLoading, setOpLoading] = useState(false);

  // 查看操作参数 Drawer
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [currentOpLog, setCurrentOpLog] = useState<OperationLog | null>(null);

  const fetchLoginLogs = useCallback(async () => {
    setLoginLoading(true);
    try {
      const res = await apiClient.get<PaginatedResult<LoginLog>>('/audit/login-logs', {
        params: { page: loginPage, pageSize: 10 },
      });
      setLoginLogs(res.data.items || res.data.data || []);
      setLoginTotal(res.data.total || 0);
    } catch (e) {
      console.error('Failed to load login logs:', e);
    } finally {
      setLoginLoading(false);
    }
  }, [loginPage]);

  const fetchOpLogs = useCallback(async () => {
    setOpLoading(true);
    try {
      const res = await apiClient.get<PaginatedResult<OperationLog>>('/audit/operation-logs', {
        params: { page: opPage, pageSize: 10 },
      });
      setOpLogs(res.data.items || res.data.data || []);
      setOpTotal(res.data.total || 0);
    } catch (e) {
      console.error('Failed to load op logs:', e);
    } finally {
      setOpLoading(false);
    }
  }, [opPage]);

  useEffect(() => {
    if (activeTab === 'LOGIN') {
      fetchLoginLogs();
    } else {
      fetchOpLogs();
    }
  }, [activeTab, fetchLoginLogs, fetchOpLogs]);

  const handleOpenDetail = (log: OperationLog) => {
    setCurrentOpLog(log);
    setDetailDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E40AF] flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">安全与合规审计看板</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            全量记录系统身份鉴权活动与高风险写操作流水，敏感数据已在入库阶段完成自动脱敏
          </p>
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            onClick={() => setActiveTab('LOGIN')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'LOGIN'
                ? 'bg-white text-[#1E40AF] font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            登录活动日志
          </button>
          <button
            onClick={() => setActiveTab('OPERATION')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'OPERATION'
                ? 'bg-white text-[#1E40AF] font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            业务操作流水
          </button>
        </div>
      </div>

      {/* 登录日志表格 */}
      {activeTab === 'LOGIN' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">登录认证历史流水</span>
            <button
              onClick={fetchLoginLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium transition-colors cursor-pointer border border-slate-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loginLoading ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-6">尝试账号</th>
                  <th className="py-3.5 px-6">客户端 IP</th>
                  <th className="py-3.5 px-6">浏览器 User-Agent</th>
                  <th className="py-3.5 px-6">鉴权状态</th>
                  <th className="py-3.5 px-6">附带信息</th>
                  <th className="py-3.5 px-6 text-right">登录时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loginLoading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                        <span>正在拉取登录日志...</span>
                      </div>
                    </td>
                  </tr>
                ) : loginLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      暂无登录日志记录
                    </td>
                  </tr>
                ) : (
                  loginLogs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-6 font-semibold text-slate-800">
                        @{l.username}
                      </td>

                      <td className="py-3.5 px-6 font-mono text-[11px] text-slate-600">
                        {l.ip}
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 text-[11px] max-w-xs truncate">
                        {l.userAgent || '未知设备'}
                      </td>

                      <td className="py-3.5 px-6">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                            l.status === 'SUCCESS'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          {l.status === 'SUCCESS' ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-600" />
                          )}
                          <span>{l.status === 'SUCCESS' ? '认证成功' : '认证被拒'}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 text-[11px]">
                        {l.message || '-'}
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 text-[11px] text-right">
                        {new Date(l.createdAt).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 操作日志表格 */}
      {activeTab === 'OPERATION' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">写操作调用流水</span>
            <button
              onClick={fetchOpLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium transition-colors cursor-pointer border border-slate-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${opLoading ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-6">操作人</th>
                  <th className="py-3.5 px-6">业务模块</th>
                  <th className="py-3.5 px-6">请求动作</th>
                  <th className="py-3.5 px-6">接口路径</th>
                  <th className="py-3.5 px-6">耗时</th>
                  <th className="py-3.5 px-6">响应码</th>
                  <th className="py-3.5 px-6">操作时间</th>
                  <th className="py-3.5 px-6 text-right">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {opLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                        <span>正在拉取操作日志...</span>
                      </div>
                    </td>
                  </tr>
                ) : opLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      暂无操作日志记录
                    </td>
                  </tr>
                ) : (
                  opLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-6 font-semibold text-slate-800">
                        @{log.username}
                      </td>

                      <td className="py-3.5 px-6">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium border border-slate-200">
                          {log.module}
                        </span>
                      </td>

                      <td className="py-3.5 px-6">
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold border ${
                            log.method === 'POST'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : log.method === 'PUT' || log.method === 'PATCH'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          {log.method}
                        </span>
                      </td>

                      <td className="py-3.5 px-6 font-mono text-[11px] text-slate-600">
                        {log.path}
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 font-mono text-[11px]">
                        {log.duration}ms
                      </td>

                      <td className="py-3.5 px-6 font-mono text-[11px]">
                        <span
                          className={
                            log.status >= 400 ? 'text-red-600 font-bold' : 'text-emerald-600'
                          }
                        >
                          {log.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 text-[11px]">
                        {new Date(log.createdAt).toLocaleString('zh-CN')}
                      </td>

                      <td className="py-3.5 px-6 text-right">
                        <button
                          onClick={() => handleOpenDetail(log)}
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="查看脱敏参数详情"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 参数详情 Drawer */}
      <RightDrawer
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        title="审计日志调用参数详情"
        description="该次写操作所携带的 Payload 数据，其中 password / token 等敏感参数已由服务端拦截器自动脱敏"
        footer={
          <button
            onClick={() => setDetailDrawerOpen(false)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            关闭窗口
          </button>
        }
      >
        {currentOpLog && (
          <div className="space-y-4">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">操作人:</span>
                <span className="font-semibold text-slate-800">@{currentOpLog.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">请求路径:</span>
                <span className="font-mono text-slate-700">{currentOpLog.path}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">请求方法:</span>
                <span className="font-mono font-bold text-blue-700">{currentOpLog.method}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">客户端 IP:</span>
                <span className="font-mono text-slate-700">{currentOpLog.ip}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                请求体参数快照 (JSON 脱敏格式)
              </label>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(currentOpLog.params || '{}'), null, 2);
                  } catch {
                    return currentOpLog.params || '无参数';
                  }
                })()}
              </pre>
            </div>
          </div>
        )}
      </RightDrawer>
    </div>
  );
}
