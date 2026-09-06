'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  KeyRound,
  Edit2,
  CheckCircle2,
  XCircle,
  Building2,
  Mail,
  Phone,
  Filter,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { User, Role, Department, PaginatedResult } from '@/types/auth';
import { RightDrawer } from '@/components/common/right-drawer';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Drawer 状态
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [roleDrawerOpen, setRoleDrawerOpen] = useState(false);
  const [pwdDrawerOpen, setPwdDrawerOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // 用户表单状态
  const [formUsername, setFormUsername] = useState('');
  const [formRealName, setFormRealName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formDeptId, setFormDeptId] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // 角色分配状态
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);

  // 重置密码状态
  const [newPassword, setNewPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);

  // 提示信息
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string | number> = { page, pageSize };
      if (keyword) params.keyword = keyword;
      if (statusFilter) params.status = statusFilter;
      if (departmentFilter) params.departmentId = departmentFilter;

      const res = await apiClient.get<PaginatedResult<User>>('/users', { params });
      setUsers(res.data.items || res.data.data || []);
      setTotal(res.data.total || 0);
    } catch {
      showToast('获取用户列表失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, keyword, statusFilter, departmentFilter]);

  const fetchMetadata = async () => {
    try {
      const [deptRes, rolesRes] = await Promise.all([
        apiClient.get('/departments/tree').catch(() => ({ data: [] })),
        apiClient.get('/roles').catch(() => ({ data: { items: [] } })),
      ]);
      setDepartments(deptRes.data || []);
      setRoles(rolesRes.data.items || (Array.isArray(rolesRes.data) ? rolesRes.data : []));
    } catch (e) {
      console.error('Failed to load depts/roles', e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchMetadata();
  }, []);

  const handleOpenCreateDrawer = () => {
    setCurrentUser(null);
    setFormUsername('');
    setFormRealName('');
    setFormPassword('');
    setFormEmail('');
    setFormPhone('');
    setFormDeptId('');
    setFormError('');
    setUserDrawerOpen(true);
  };

  const handleOpenEditDrawer = (user: User) => {
    setCurrentUser(user);
    setFormUsername(user.username);
    setFormRealName(user.realName || '');
    setFormPassword('');
    setFormEmail(user.email || '');
    setFormPhone(user.phone || '');
    setFormDeptId(user.departmentId || '');
    setFormError('');
    setUserDrawerOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');

    try {
      if (currentUser) {
        // 编辑
        await apiClient.put(`/users/${currentUser.id}`, {
          realName: formRealName || undefined,
          email: formEmail || undefined,
          phone: formPhone || undefined,
          departmentId: formDeptId || null,
        });
        showToast('用户信息更新成功');
      } else {
        // 新建
        if (!formUsername || !formPassword) {
          setFormError('用户名和密码为必填项');
          setFormLoading(false);
          return;
        }
        await apiClient.post('/users', {
          username: formUsername,
          password: formPassword,
          realName: formRealName || undefined,
          email: formEmail || undefined,
          phone: formPhone || undefined,
          departmentId: formDeptId || undefined,
        });
        showToast('新建用户成功');
      }

      setUserDrawerOpen(false);
      fetchUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setFormError(error.response?.data?.message || '操作失败，请重试');
    } finally {
      setFormLoading(false);
    }
  };

  const handleOpenRoleDrawer = (user: User) => {
    setCurrentUser(user);
    const existingRoleIds = user.roles?.map((r) => r.id) ||
      user.userRoles?.map((ur) => ur.role?.id) || [];
    setSelectedRoleIds(existingRoleIds);
    setRoleDrawerOpen(true);
  };

  const handleSaveRoles = async () => {
    if (!currentUser) return;
    setRoleLoading(true);
    try {
      await apiClient.put(`/users/${currentUser.id}/roles`, {
        roleIds: selectedRoleIds,
      });
      showToast('角色权限分配成功，已同步触发版本轮转');
      setRoleDrawerOpen(false);
      fetchUsers();
    } catch {
      showToast('分配角色失败', 'error');
    } finally {
      setRoleLoading(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const targetStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiClient.patch(`/users/${user.id}/status`, { status: targetStatus });
      showToast(`已${targetStatus === 'ACTIVE' ? '启用' : '禁用'}用户 ${user.username}`);
      fetchUsers();
    } catch {
      showToast('更新用户状态失败', 'error');
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!confirm(`确定要软删除用户【${user.username}】吗？`)) return;
    try {
      await apiClient.delete(`/users/${user.id}`);
      showToast(`已软删除用户 ${user.username}`);
      fetchUsers();
    } catch {
      showToast('删除用户失败', 'error');
    }
  };

  const handleOpenResetPwd = (user: User) => {
    setCurrentUser(user);
    setNewPassword('');
    setPwdDrawerOpen(true);
  };

  const handleSaveResetPwd = async () => {
    if (!currentUser || !newPassword) return;
    setPwdLoading(true);
    try {
      await apiClient.patch(`/users/${currentUser.id}/reset-password`, {
        newPassword,
      });
      showToast(`已重置用户 ${currentUser.username} 的密码`);
      setPwdDrawerOpen(false);
    } catch {
      showToast('重置密码失败', 'error');
    } finally {
      setPwdLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Toast 悬浮提示 */}
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

      {/* 顶部标题与快速统计卡片 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E40AF] flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">用户管理中心</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            企业组织架构成员生命周期管控，支持部门挂载、多角色指派与双向鉴权同步
          </p>
        </div>

        <AuthGuard permission="sys:user:create">
          <button
            onClick={handleOpenCreateDrawer}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1E40AF] hover:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新建用户</span>
          </button>
        </AuthGuard>
      </div>

      {/* 搜索与过滤工具栏 */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* 关键字搜索 */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="按姓名、账号、邮箱、手机检索..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
            />
          </div>

          {/* 状态筛选 */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">正常启用 (ACTIVE)</option>
            <option value="INACTIVE">停用冻结 (INACTIVE)</option>
            <option value="LOCKED">安全锁定 (LOCKED)</option>
          </select>

          {/* 部门筛选 */}
          <select
            value={departmentFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="">全公司部门</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setKeyword('');
              setStatusFilter('');
              setDepartmentFilter('');
              setPage(1);
            }}
            className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            重置
          </button>
          <button
            onClick={() => fetchUsers()}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>查询</span>
          </button>
        </div>
      </div>

      {/* 用户表格区 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-6">用户身份</th>
                <th className="py-3.5 px-6">组织部门</th>
                <th className="py-3.5 px-6">关联角色</th>
                <th className="py-3.5 px-6">状态</th>
                <th className="py-3.5 px-6">安全版本</th>
                <th className="py-3.5 px-6">创建时间</th>
                <th className="py-3.5 px-6 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-blue-600/30 border-t-[#1E40AF] rounded-full animate-spin" />
                      <span>正在拉取用户数据...</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Users className="w-8 h-8 text-slate-300" />
                      <span>暂无匹配的用户记录</span>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const userRoles = u.roles || u.userRoles?.map((ur) => ur.role) || [];
                  const isSuper = userRoles.some((r) => r.code === 'super_admin');

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* 用户基础信息 */}
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-blue-50 text-[#1E40AF] font-bold text-xs flex items-center justify-center border border-blue-100">
                            {u.realName?.[0] || u.username[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>{u.realName || u.username}</span>
                              {isSuper && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
                                  超管
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                              <span>@{u.username}</span>
                              {u.email && (
                                <>
                                  <span>•</span>
                                  <span className="truncate max-w-[120px]">{u.email}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 所属部门 */}
                      <td className="py-3.5 px-6 text-slate-600">
                        {u.department ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-[11px] text-slate-700 font-medium">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            <span>{u.department.name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">未归属部门</span>
                        )}
                      </td>

                      {/* 关联角色 */}
                      <td className="py-3.5 px-6">
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {userRoles.length > 0 ? (
                            userRoles.map((r) => (
                              <span
                                key={r.id}
                                className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                                  r.code === 'super_admin'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}
                              >
                                {r.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 italic">未指派角色</span>
                          )}
                        </div>
                      </td>

                      {/* 启停状态 */}
                      <td className="py-3.5 px-6">
                        <button
                          onClick={() => handleToggleStatus(u)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
                            u.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                          }`}
                          title="点击切换启用/停用"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          <span>{u.status === 'ACTIVE' ? '正常' : '已停用'}</span>
                        </button>
                      </td>

                      {/* 安全 TokenVersion */}
                      <td className="py-3.5 px-6">
                        <span className="font-mono text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          v{u.tokenVersion}
                        </span>
                      </td>

                      {/* 创建时间 */}
                      <td className="py-3.5 px-6 text-slate-500 text-[11px]">
                        {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                      </td>

                      {/* 操作区 */}
                      <td className="py-3.5 px-6 text-right space-x-1">
                        <button
                          onClick={() => handleOpenRoleDrawer(u)}
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="分配角色"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleOpenEditDrawer(u)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                          title="编辑资料"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleOpenResetPwd(u)}
                          className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          title="重置密码"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="软删除"
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

        {/* 底部分页条 */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-xs text-slate-500">
          <div>
            共 <span className="font-semibold text-slate-700">{total}</span> 名用户，当前第{' '}
            <span className="font-semibold text-slate-700">{page}</span> / {totalPages} 页
          </div>
          <div className="flex items-center gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <span className="px-2 text-slate-700 font-medium">{page}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* 抽屉 1: 新建 / 编辑用户 Drawer */}
      <RightDrawer
        isOpen={userDrawerOpen}
        onClose={() => setUserDrawerOpen(false)}
        title={currentUser ? '编辑用户信息' : '新建系统用户'}
        description={
          currentUser
            ? '更新指定用户的核心档案与部门归属信息'
            : '录入新的企业员工账号，自动创建密码并支持挂载组织架构'
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setUserDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={formLoading}
              onClick={handleSaveUser}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {formLoading ? '保存中...' : '确认保存'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSaveUser} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              用户名（唯一标识）*
            </label>
            <input
              type="text"
              disabled={!!currentUser}
              value={formUsername}
              onChange={(e) => setFormUsername(e.target.value)}
              placeholder="如: zhangsan, admin"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white disabled:opacity-60"
              required
            />
          </div>

          {!currentUser && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                登录初始密码 *
              </label>
              <input
                type="password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder="设置初始密码（至少 6 位）"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">真实姓名</label>
            <input
              type="text"
              value={formRealName}
              onChange={(e) => setFormRealName(e.target.value)}
              placeholder="员工实际姓名"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">电子邮箱</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">联系电话</label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="手机号码"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">挂载组织部门</label>
            <select
              value={formDeptId}
              onChange={(e) => setFormDeptId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="">暂不分配部门</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      </RightDrawer>

      {/* 抽屉 2: 分配角色 Drawer */}
      <RightDrawer
        isOpen={roleDrawerOpen}
        onClose={() => setRoleDrawerOpen(false)}
        title={`分配角色 - ${currentUser?.realName || currentUser?.username}`}
        description="勾选该用户所需拥有的系统角色，保存后将自动自增用户的安全 Token 版本，强制重新拉取最新权限。"
        footer={
          <>
            <button
              onClick={() => setRoleDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              disabled={roleLoading}
              onClick={handleSaveRoles}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {roleLoading ? '保存中...' : '确认指派角色'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500">可多选分配：</p>
          <div className="space-y-2">
            {roles.map((r) => {
              const checked = selectedRoleIds.includes(r.id);
              return (
                <label
                  key={r.id}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                    checked
                      ? 'bg-blue-50/70 border-blue-200 text-blue-950'
                      : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-100/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRoleIds([...selectedRoleIds, r.id]);
                      } else {
                        setSelectedRoleIds(selectedRoleIds.filter((id) => id !== r.id));
                      }
                    }}
                    className="mt-0.5 rounded border-slate-300 text-[#1E40AF] focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-slate-900">{r.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 bg-white px-1.5 py-0.2 rounded border border-slate-200">
                        {r.code}
                      </span>
                    </div>
                    {r.description && (
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        {r.description}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </RightDrawer>

      {/* 抽屉 3: 重置密码 Drawer */}
      <RightDrawer
        isOpen={pwdDrawerOpen}
        onClose={() => setPwdDrawerOpen(false)}
        title={`重置密码 - ${currentUser?.username}`}
        description="重置后用户现有登录 Session 将自动失效，需使用新设定的密码重新登录。"
        footer={
          <>
            <button
              onClick={() => setPwdDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              disabled={pwdLoading || !newPassword}
              onClick={handleSaveResetPwd}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {pwdLoading ? '重置中...' : '确认重置密码'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              输入新密码 *
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="请输入新的安全密码（建议包含字母与符号）"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>
        </div>
      </RightDrawer>
    </div>
  );
}
