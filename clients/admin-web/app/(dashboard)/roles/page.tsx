'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Plus,
  RefreshCw,
  Edit2,
  Trash2,
  Key,
  CheckCircle2,
  XCircle,
  Lock,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  Search,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Role, Permission, PaginatedResult } from '@/types/auth';
import { RightDrawer } from '@/components/common/right-drawer';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionTree, setPermissionTree] = useState<Permission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Drawer 状态
  const [roleDrawerOpen, setRoleDrawerOpen] = useState(false);
  const [permDrawerOpen, setPermDrawerOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);

  // 角色表单
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // 权限勾选树状态
  const [selectedPermIds, setSelectedPermIds] = useState<string[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [permSearch, setPermSearch] = useState('');
  const [expandedNodeIds, setExpandedNodeIds] = useState<Record<string, boolean>>({});

  // 提示信息
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<PaginatedResult<Role> | Role[]>('/roles');
      const list = (res.data as PaginatedResult<Role>).items || (Array.isArray(res.data) ? res.data : []);
      setRoles(list);
    } catch {
      showToast('获取角色列表失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchPermissionTree = async () => {
    try {
      const res = await apiClient.get<Permission[]>('/permissions/tree');
      setPermissionTree(res.data || []);
      // 默认全展开顶级节点
      const initExpanded: Record<string, boolean> = {};
      const expandAll = (nodes: Permission[]) => {
        for (const n of nodes) {
          initExpanded[n.id] = true;
          if (n.children?.length) expandAll(n.children);
        }
      };
      expandAll(res.data || []);
      setExpandedNodeIds(initExpanded);
    } catch (e) {
      console.error('Failed to load permission tree:', e);
    }
  };

  useEffect(() => {
    fetchRoles();
    fetchPermissionTree();
  }, [fetchRoles]);

  // 新建角色 Drawer
  const handleOpenCreateDrawer = () => {
    setCurrentRole(null);
    setFormName('');
    setFormCode('');
    setFormDesc('');
    setFormError('');
    setRoleDrawerOpen(true);
  };

  // 编辑角色 Drawer
  const handleOpenEditDrawer = (role: Role) => {
    setCurrentRole(role);
    setFormName(role.name);
    setFormCode(role.code);
    setFormDesc(role.description || '');
    setFormError('');
    setRoleDrawerOpen(true);
  };

  // 保存角色
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');

    try {
      if (currentRole) {
        await apiClient.put(`/roles/${currentRole.id}`, {
          name: formName,
          description: formDesc || undefined,
        });
        showToast(`已更新角色【${formName}】`);
      } else {
        if (!formName || !formCode) {
          setFormError('角色名称与编码为必填项');
          setFormLoading(false);
          return;
        }
        await apiClient.post('/roles', {
          name: formName,
          code: formCode,
          description: formDesc || undefined,
        });
        showToast('新建角色成功');
      }

      setRoleDrawerOpen(false);
      fetchRoles();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setFormError(error.response?.data?.message || '操作失败，请重试');
    } finally {
      setFormLoading(false);
    }
  };

  // 删除角色
  const handleDeleteRole = async (role: Role) => {
    if (role.code === 'super_admin' || role.isSystem) {
      showToast('系统内置角色受保护，禁止删除', 'error');
      return;
    }
    if (!confirm(`确定要彻底删除角色【${role.name}】(${role.code}) 吗？`)) return;

    try {
      await apiClient.delete(`/roles/${role.id}`);
      showToast(`已删除角色 ${role.name}`);
      fetchRoles();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      showToast(error.response?.data?.message || '删除角色失败', 'error');
    }
  };

  // 打开权限配置 Drawer
  const handleOpenPermDrawer = async (role: Role) => {
    setCurrentRole(role);
    setPermDrawerOpen(true);
    setPermLoading(true);
    try {
      // 角色详情回显已有权限
      const res = await apiClient.get<Role>(`/roles/${role.id}`);
      const ids: string[] = [];
      if (res.data.rolePermissions) {
        res.data.rolePermissions.forEach((rp) => ids.push(rp.permissionId));
      } else if (res.data.permissions) {
        res.data.permissions.forEach((p) => ids.push(p.id));
      }
      setSelectedPermIds(ids);
    } catch {
      showToast('拉取角色已有权限失败', 'error');
    } finally {
      setPermLoading(false);
    }
  };

  // 收集节点及其所有子节点的 ID
  const getAllDescendantIds = (node: Permission): string[] => {
    let ids = [node.id];
    if (node.children) {
      for (const c of node.children) {
        ids = ids.concat(getAllDescendantIds(c));
      }
    }
    return ids;
  };

  // 级联勾选/取消勾选节点
  const handleTogglePermNode = (node: Permission) => {
    const descendantIds = getAllDescendantIds(node);
    const isCurrentlyChecked = selectedPermIds.includes(node.id);

    if (isCurrentlyChecked) {
      // 取消该节点及其所有子孙
      setSelectedPermIds(selectedPermIds.filter((id) => !descendantIds.includes(id)));
    } else {
      // 勾选该节点及其所有子孙
      const newIds = new Set([...selectedPermIds, ...descendantIds]);
      setSelectedPermIds(Array.from(newIds));
    }
  };

  // 全选/清空
  const handleSelectAllPerms = () => {
    const allIds: string[] = [];
    const collect = (nodes: Permission[]) => {
      for (const n of nodes) {
        allIds.push(n.id);
        if (n.children?.length) collect(n.children);
      }
    };
    collect(permissionTree);
    setSelectedPermIds(allIds);
  };

  const handleClearAllPerms = () => {
    setSelectedPermIds([]);
  };

  // 保存权限配置
  const handleSavePermissions = async () => {
    if (!currentRole) return;
    setPermLoading(true);
    try {
      await apiClient.put(`/roles/${currentRole.id}/permissions`, {
        permissionIds: selectedPermIds,
      });
      showToast('权限分配成功！已联动将所属用户的安全凭据版本自增');
      setPermDrawerOpen(false);
    } catch {
      showToast('保存权限失败', 'error');
    } finally {
      setPermLoading(false);
    }
  };

  // 递归渲染权限复选树
  const renderPermNode = (node: Permission, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodeIds[node.id] ?? true;
    const isChecked = selectedPermIds.includes(node.id);

    const typeBadge = {
      MENU: 'bg-blue-50 text-blue-700 border-blue-200',
      BUTTON: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      API: 'bg-purple-50 text-purple-700 border-purple-200',
    }[node.type] || 'bg-slate-100 text-slate-600 border-slate-200';

    return (
      <div key={node.id} className="space-y-1">
        <div
          className={`flex items-center justify-between py-1.5 px-2.5 rounded-xl hover:bg-slate-50 transition-colors ${
            isChecked ? 'bg-blue-50/40' : ''
          }`}
          style={{ marginLeft: `${depth * 18}px` }}
        >
          <div className="flex items-center gap-2 flex-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={() =>
                  setExpandedNodeIds((prev) => ({ ...prev, [node.id]: !prev[node.id] }))
                }
                className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-4" />
            )}

            <label className="flex items-center gap-2 text-xs text-slate-800 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => handleTogglePermNode(node)}
                className="rounded border-slate-300 text-[#1E40AF] focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span>{node.name}</span>
            </label>

            <span className="text-[10px] font-mono text-slate-400">
              ({node.code})
            </span>
          </div>

          <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${typeBadge}`}>
            {node.type}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div className="border-l border-slate-100 ml-4 pl-1">
            {node.children!.map((child) => renderPermNode(child, depth + 1))}
          </div>
        )}
      </div>
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

      {/* 头部标题与新建按钮 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E40AF] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">角色管理中心</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            维护系统授权策略角色实体，通过右侧树形抽屉实现按系统/菜单/按钮的直观细粒度权限勾选
          </p>
        </div>

        <AuthGuard permission="sys:role:create">
          <button
            onClick={handleOpenCreateDrawer}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1E40AF] hover:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新建角色</span>
          </button>
        </AuthGuard>
      </div>

      {/* 角色列表表格 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">系统角色清单 ({roles.length})</span>
          <button
            onClick={fetchRoles}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium transition-colors cursor-pointer border border-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-6">角色名称</th>
                <th className="py-3.5 px-6">唯一编码</th>
                <th className="py-3.5 px-6">角色描述</th>
                <th className="py-3.5 px-6">系统保护</th>
                <th className="py-3.5 px-6">创建时间</th>
                <th className="py-3.5 px-6 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                      <span>正在拉取角色信息...</span>
                    </div>
                  </td>
                </tr>
              ) : roles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    暂无角色数据
                  </td>
                </tr>
              ) : (
                roles.map((r) => {
                  const isProtected = r.code === 'super_admin' || r.isSystem;

                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#1E40AF]" />
                          <span>{r.name}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-6">
                        <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-100 text-slate-700 border border-slate-200">
                          {r.code}
                        </span>
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 max-w-sm truncate">
                        {r.description || <span className="italic text-slate-400">暂无说明</span>}
                      </td>

                      <td className="py-3.5 px-6">
                        {isProtected ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            <Lock className="w-3 h-3 text-amber-600" />
                            <span>内置核心</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">自定义</span>
                        )}
                      </td>

                      <td className="py-3.5 px-6 text-slate-500 text-[11px]">
                        {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                      </td>

                      <td className="py-3.5 px-6 text-right space-x-1">
                        <button
                          onClick={() => handleOpenPermDrawer(r)}
                          className="p-1.5 text-[#1E40AF] hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="配置权限树"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>

                        <button
                          disabled={isProtected}
                          onClick={() => handleOpenEditDrawer(r)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          title={isProtected ? '内置角色不可编辑' : '编辑角色'}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          disabled={isProtected}
                          onClick={() => handleDeleteRole(r)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          title={isProtected ? '内置角色禁止删除' : '删除角色'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 抽屉 1: 新建 / 编辑角色 Drawer */}
      <RightDrawer
        isOpen={roleDrawerOpen}
        onClose={() => setRoleDrawerOpen(false)}
        title={currentRole ? '编辑角色信息' : '创建新系统角色'}
        description="定义权限策略容器，绑定后可对用户组生效"
        footer={
          <>
            <button
              onClick={() => setRoleDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              disabled={formLoading}
              onClick={handleSaveRole}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {formLoading ? '保存中...' : '确认保存'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSaveRole} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              角色名称 *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="如: 安全合规专员, 财务主管"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              角色唯一标识编码 *
            </label>
            <input
              type="text"
              disabled={!!currentRole}
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              placeholder="如: sec_officer, fin_manager"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white disabled:opacity-60"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              角色职权描述
            </label>
            <textarea
              rows={3}
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="简述该角色的系统职责与管控边界..."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>
        </form>
      </RightDrawer>

      {/* 抽屉 2: 权限配置中心 Drawer (Checkbox 树形结构，按系统 / 菜单 / 权限分组) */}
      <RightDrawer
        isOpen={permDrawerOpen}
        onClose={() => setPermDrawerOpen(false)}
        title={`分配权限树 - ${currentRole?.name} (${currentRole?.code})`}
        description="按系统 / 菜单 / 按钮层级分组勾选所需拥有的操作权限，支持级联级选中"
        width="xl"
        footer={
          <>
            <div className="flex items-center gap-2 mr-auto text-xs text-slate-500">
              <span>已勾选: </span>
              <span className="font-bold text-[#1E40AF]">{selectedPermIds.length}</span>
              <span>项权限</span>
            </div>
            <button
              onClick={() => setPermDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              disabled={permLoading}
              onClick={handleSavePermissions}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {permLoading ? '保存中...' : '提交授权配置'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* 快捷批量操作工具 */}
          <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-600 font-medium">快捷全选工具：</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllPerms}
                className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 transition-colors cursor-pointer"
              >
                <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                <span>全选所有</span>
              </button>
              <button
                type="button"
                onClick={handleClearAllPerms}
                className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 text-slate-400" />
                <span>一键清空</span>
              </button>
            </div>
          </div>

          {/* 权限节点树容器 */}
          <div className="p-3 bg-white rounded-xl border border-slate-200/80 space-y-1 max-h-[600px] overflow-y-auto">
            {permLoading ? (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                <span>正在加载权限树与回显数据...</span>
              </div>
            ) : permissionTree.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">暂无可用权限树节点</div>
            ) : (
              permissionTree.map((rootNode) => renderPermNode(rootNode))
            )}
          </div>
        </div>
      </RightDrawer>
    </div>
  );
}
