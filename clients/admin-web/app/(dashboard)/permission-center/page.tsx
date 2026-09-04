'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  Plus,
  RefreshCw,
  Edit2,
  Trash2,
  FolderTree,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  PlusCircle,
  LayoutGrid,
  MousePointerClick,
  Globe,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Permission } from '@/types/auth';
import { RightDrawer } from '@/components/common/right-drawer';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function PermissionCenterPage() {
  const [permissionTree, setPermissionTree] = useState<Permission[]>([]);
  const [flatPermissions, setFlatPermissions] = useState<Permission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Drawer 状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentPerm, setCurrentPerm] = useState<Permission | null>(null);
  const [presetParentId, setPresetParentId] = useState<string | null>(null);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formType, setFormType] = useState<'MENU' | 'BUTTON' | 'API'>('MENU');
  const [formPath, setFormPath] = useState('');
  const [formIcon, setFormIcon] = useState('');
  const [formSort, setFormSort] = useState<number>(0);
  const [formParentId, setFormParentId] = useState<string>('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const flattenTree = (nodes: Permission[]): Permission[] => {
    let result: Permission[] = [];
    for (const n of nodes) {
      result.push(n);
      if (n.children && n.children.length > 0) {
        result = result.concat(flattenTree(n.children));
      }
    }
    return result;
  };

  const fetchPermissions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<Permission[]>('/permissions/tree');
      const data = res.data || [];
      setPermissionTree(data);
      setFlatPermissions(flattenTree(data));

      // 默认全展开
      const exp: Record<string, boolean> = {};
      const expandAll = (nodes: Permission[]) => {
        for (const n of nodes) {
          exp[n.id] = true;
          if (n.children?.length) expandAll(n.children);
        }
      };
      expandAll(data);
      setExpandedIds(exp);
    } catch {
      showToast('获取权限资源树失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const handleOpenCreateDrawer = (parentId?: string) => {
    setCurrentPerm(null);
    setPresetParentId(parentId || null);
    setFormName('');
    setFormCode('');
    setFormType(parentId ? 'BUTTON' : 'MENU');
    setFormPath('');
    setFormIcon('');
    setFormSort(0);
    setFormParentId(parentId || '');
    setFormError('');
    setDrawerOpen(true);
  };

  const handleOpenEditDrawer = (perm: Permission) => {
    setCurrentPerm(perm);
    setPresetParentId(null);
    setFormName(perm.name);
    setFormCode(perm.code);
    setFormType(perm.type);
    setFormPath(perm.path || '');
    setFormIcon(perm.icon || '');
    setFormSort(perm.sort || 0);
    setFormParentId(perm.parentId || '');
    setFormError('');
    setDrawerOpen(true);
  };

  const handleSavePermission = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');

    try {
      if (currentPerm) {
        await apiClient.put(`/permissions/${currentPerm.id}`, {
          name: formName,
          code: formCode,
          type: formType,
          path: formPath || undefined,
          icon: formIcon || undefined,
          sort: Number(formSort),
          parentId: formParentId || null,
        });
        showToast(`已更新权限【${formName}】`);
      } else {
        if (!formName || !formCode) {
          setFormError('名称与权限码为必填项');
          setFormLoading(false);
          return;
        }
        await apiClient.post('/permissions', {
          name: formName,
          code: formCode,
          type: formType,
          path: formPath || undefined,
          icon: formIcon || undefined,
          sort: Number(formSort),
          parentId: formParentId || undefined,
        });
        showToast('新建权限成功');
      }

      setDrawerOpen(false);
      fetchPermissions();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setFormError(error.response?.data?.message || '操作失败，请检查参数');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeletePermission = async (perm: Permission) => {
    if (perm.children && perm.children.length > 0) {
      showToast('该权限包含子节点，请先删除或移走子节点', 'error');
      return;
    }
    if (!confirm(`确定要彻底删除权限【${perm.name}】(${perm.code}) 吗？`)) return;

    try {
      await apiClient.delete(`/permissions/${perm.id}`);
      showToast(`已删除权限【${perm.name}】`);
      fetchPermissions();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      showToast(error.response?.data?.message || '删除权限失败', 'error');
    }
  };

  const renderTypeIcon = (type: string) => {
    switch (type) {
      case 'MENU':
        return <LayoutGrid className="w-3.5 h-3.5 text-blue-600" />;
      case 'BUTTON':
        return <MousePointerClick className="w-3.5 h-3.5 text-emerald-600" />;
      default:
        return <Globe className="w-3.5 h-3.5 text-purple-600" />;
    }
  };

  const renderTreeRow = (node: Permission, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds[node.id] ?? true;

    return (
      <React.Fragment key={node.id}>
        <tr className="hover:bg-slate-50/70 transition-colors">
          <td className="py-3 px-6">
            <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
              {hasChildren ? (
                <button
                  onClick={() =>
                    setExpandedIds((prev) => ({ ...prev, [node.id]: !prev[node.id] }))
                  }
                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-5" />
              )}

              <div className="flex items-center gap-2">
                {renderTypeIcon(node.type)}
                <span className="font-semibold text-slate-800">{node.name}</span>
              </div>
            </div>
          </td>

          <td className="py-3 px-6">
            <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-100 text-slate-700 border border-slate-200">
              {node.code}
            </span>
          </td>

          <td className="py-3 px-6">
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                node.type === 'MENU'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : node.type === 'BUTTON'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-purple-50 text-purple-700 border-purple-200'
              }`}
            >
              {node.type}
            </span>
          </td>

          <td className="py-3 px-6 text-slate-500 font-mono text-[11px]">
            {node.path || <span className="text-slate-400 italic">-</span>}
          </td>

          <td className="py-3 px-6 text-slate-500 font-mono text-[11px]">
            {node.sort}
          </td>

          <td className="py-3 px-6 text-right space-x-1">
            <button
              onClick={() => handleOpenCreateDrawer(node.id)}
              className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
              title="新增子权限"
            >
              <PlusCircle className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleOpenEditDrawer(node)}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="编辑"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleDeletePermission(node)}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </td>
        </tr>

        {hasChildren && isExpanded && node.children!.map((child) => renderTreeRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toast 提示 */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-8 z-50 px-4 py-2.5 rounded-xl shadow-lg border flex items-center gap-2 text-xs font-medium animate-fadeIn ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* 顶部标题与新建 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E40AF] flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">权限配置中心</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            定义全系统功能树形资源规范，支持菜单路由、按钮动作与 API 网关三位一体权限标识
          </p>
        </div>

        <AuthGuard permission="sys:permission:create">
          <button
            onClick={() => handleOpenCreateDrawer()}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1E40AF] hover:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新建根权限</span>
          </button>
        </AuthGuard>
      </div>

      {/* 权限资源树形表格 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-[#1E40AF]" />
            <span className="text-xs font-semibold text-slate-700">
              系统权限资源层级拓扑树 ({flatPermissions.length} 个节点)
            </span>
          </div>

          <button
            onClick={fetchPermissions}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium transition-colors cursor-pointer border border-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>刷新树</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-6">权限资源名称</th>
                <th className="py-3.5 px-6">权限标识码</th>
                <th className="py-3.5 px-6">节点类型</th>
                <th className="py-3.5 px-6">前端路由</th>
                <th className="py-3.5 px-6">排序</th>
                <th className="py-3.5 px-6 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                      <span>正在拉取权限树拓扑结构...</span>
                    </div>
                  </td>
                </tr>
              ) : permissionTree.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    暂无权限资源节点
                  </td>
                </tr>
              ) : (
                permissionTree.map((rootNode) => renderTreeRow(rootNode))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 抽屉: 新建 / 编辑权限 Drawer */}
      <RightDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={currentPerm ? '编辑权限节点' : '新建权限资源'}
        description="定义系统操作资源节点并挂载至树形拓扑"
        footer={
          <>
            <button
              onClick={() => setDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              disabled={formLoading}
              onClick={handleSavePermission}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {formLoading ? '保存中...' : '确认保存'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSavePermission} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              父级资源节点
            </label>
            <select
              value={formParentId}
              onChange={(e) => setFormParentId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="">顶级目录 (根节点)</option>
              {flatPermissions
                .filter((p) => !currentPerm || p.id !== currentPerm.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              资源类型 *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['MENU', 'BUTTON', 'API'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFormType(t)}
                  className={`py-2 text-xs font-medium rounded-xl border transition-colors cursor-pointer ${
                    formType === t
                      ? 'bg-blue-50 text-[#1E40AF] border-blue-300 font-semibold'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {t === 'MENU' ? '菜单' : t === 'BUTTON' ? '按钮' : '接口'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              权限名称 *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="如: 用户删除, 角色管理"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              权限标识码 (Colon Format) *
            </label>
            <input
              type="text"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              placeholder="如: sys:user:delete, sys:role:list"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              路由路径 (Path)
            </label>
            <input
              type="text"
              value={formPath}
              onChange={(e) => setFormPath(e.target.value)}
              placeholder="如: /users, /roles"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              显示排序
            </label>
            <input
              type="number"
              value={formSort}
              onChange={(e) => setFormSort(Number(e.target.value))}
              placeholder="0"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>
        </form>
      </RightDrawer>
    </div>
  );
}
