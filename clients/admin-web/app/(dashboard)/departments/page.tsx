'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Network,
  Plus,
  RefreshCw,
  Edit2,
  Trash2,
  Building2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Phone,
  User,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Department } from '@/types/auth';
import { RightDrawer } from '@/components/common/right-drawer';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [flatDepts, setFlatDepts] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentDept, setCurrentDept] = useState<Department | null>(null);

  // Form
  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState('');
  const [formLeader, setFormLeader] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formSort, setFormSort] = useState(0);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const flattenTree = (nodes: Department[]): Department[] => {
    let list: Department[] = [];
    for (const n of nodes) {
      list.push(n);
      if (n.children && n.children.length > 0) {
        list = list.concat(flattenTree(n.children));
      }
    }
    return list;
  };

  const fetchDepartments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<Department[]>('/departments/tree');
      const data = res.data || [];
      setDepartments(data);
      setFlatDepts(flattenTree(data));

      const exp: Record<string, boolean> = {};
      const expandAll = (nodes: Department[]) => {
        for (const n of nodes) {
          exp[n.id] = true;
          if (n.children?.length) expandAll(n.children);
        }
      };
      expandAll(data);
      setExpandedIds(exp);
    } catch {
      showToast('获取部门架构失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleOpenCreateDrawer = (parentId?: string) => {
    setCurrentDept(null);
    setFormName('');
    setFormParentId(parentId || '');
    setFormLeader('');
    setFormPhone('');
    setFormSort(0);
    setFormError('');
    setDrawerOpen(true);
  };

  const handleOpenEditDrawer = (dept: Department) => {
    setCurrentDept(dept);
    setFormName(dept.name);
    setFormParentId(dept.parentId || '');
    setFormLeader(dept.leader || '');
    setFormPhone(dept.phone || '');
    setFormSort(dept.sort || 0);
    setFormError('');
    setDrawerOpen(true);
  };

  const handleSaveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');

    try {
      if (currentDept) {
        await apiClient.put(`/departments/${currentDept.id}`, {
          name: formName,
          parentId: formParentId || null,
          leader: formLeader || undefined,
          phone: formPhone || undefined,
          sort: Number(formSort),
        });
        showToast(`已更新部门【${formName}】`);
      } else {
        if (!formName) {
          setFormError('部门名称不能为空');
          setFormLoading(false);
          return;
        }
        await apiClient.post('/departments', {
          name: formName,
          parentId: formParentId || undefined,
          leader: formLeader || undefined,
          phone: formPhone || undefined,
          sort: Number(formSort),
        });
        showToast('新建部门成功');
      }

      setDrawerOpen(false);
      fetchDepartments();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setFormError(error.response?.data?.message || '操作失败，请重试');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteDept = async (dept: Department) => {
    if (dept.children && dept.children.length > 0) {
      showToast('该部门下存在子部门，禁止直接删除', 'error');
      return;
    }
    if (!confirm(`确定要彻底删除部门【${dept.name}】吗？`)) return;

    try {
      await apiClient.delete(`/departments/${dept.id}`);
      showToast(`已删除部门【${dept.name}】`);
      fetchDepartments();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      showToast(error.response?.data?.message || '删除部门失败', 'error');
    }
  };

  const renderTreeRow = (node: Department, depth = 0) => {
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
                <Building2 className="w-4 h-4 text-[#1E40AF]" />
                <span className="font-semibold text-slate-800">{node.name}</span>
              </div>
            </div>
          </td>

          <td className="py-3 px-6 text-slate-600">
            {node.leader ? (
              <span className="inline-flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>{node.leader}</span>
              </span>
            ) : (
              <span className="text-slate-400 italic">未指定</span>
            )}
          </td>

          <td className="py-3 px-6 text-slate-500 font-mono text-[11px]">
            {node.phone || '-'}
          </td>

          <td className="py-3 px-6 text-slate-500 font-mono text-[11px]">
            {node.sort}
          </td>

          <td className="py-3 px-6 text-right space-x-1">
            <button
              onClick={() => handleOpenCreateDrawer(node.id)}
              className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
              title="新增下级部门"
            >
              <PlusCircle className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleOpenEditDrawer(node)}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="编辑部门"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleDeleteDept(node)}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title="删除部门"
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

      {/* 头部 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E40AF] flex items-center justify-center">
              <Network className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">组织架构与部门</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            维护企业树状层级组织架构，支持部门主管设置、人员层级关联与级联删除拦截
          </p>
        </div>

        <AuthGuard permission="sys:dept:create">
          <button
            onClick={() => handleOpenCreateDrawer()}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1E40AF] hover:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新建根部门</span>
          </button>
        </AuthGuard>
      </div>

      {/* 部门树表格 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">组织架构树 ({flatDepts.length} 个部门节点)</span>
          <button
            onClick={fetchDepartments}
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
                <th className="py-3.5 px-6">部门名称</th>
                <th className="py-3.5 px-6">负责人</th>
                <th className="py-3.5 px-6">联络电话</th>
                <th className="py-3.5 px-6">显示排序</th>
                <th className="py-3.5 px-6 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                      <span>正在拉取部门架构树...</span>
                    </div>
                  </td>
                </tr>
              ) : departments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    暂无部门数据
                  </td>
                </tr>
              ) : (
                departments.map((rootDept) => renderTreeRow(rootDept))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 部门 Drawer */}
      <RightDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={currentDept ? '编辑部门信息' : '创建新部门'}
        description="配置部门名称、负责人及上级组织节点"
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
              onClick={handleSaveDept}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {formLoading ? '保存中...' : '确认保存'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSaveDept} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">上级部门</label>
            <select
              value={formParentId}
              onChange={(e) => setFormParentId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="">顶级部门 (无上级)</option>
              {flatDepts
                .filter((d) => !currentDept || d.id !== currentDept.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">部门名称 *</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="如: 研发中心, 华东销售部"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">部门负责人</label>
            <input
              type="text"
              value={formLeader}
              onChange={(e) => setFormLeader(e.target.value)}
              placeholder="负责人姓名"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">联系电话</label>
            <input
              type="tel"
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              placeholder="部门对外办公电话"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">显示排序</label>
            <input
              type="number"
              value={formSort}
              onChange={(e) => setFormSort(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>
        </form>
      </RightDrawer>
    </div>
  );
}
