'use client';

import React, { useState, useEffect } from 'react';
import {
  UserCog,
  Shield,
  KeyRound,
  CheckCircle2,
  XCircle,
  Building2,
  Mail,
  Phone,
  Clock,
  Fingerprint,
  Save,
  Lock,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';
import { RightDrawer } from '@/components/common/right-drawer';

export default function ProfilePage() {
  const { user, updateUser, fetchProfileAndPermissions } = useAuthStore();

  const [realName, setRealName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 密码修改 Drawer
  const [pwdDrawerOpen, setPwdDrawerOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');

  // 提示信息
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    if (user) {
      setRealName(user.realName || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await apiClient.patch(`/users/${user.id}`, {
        realName: realName || undefined,
        email: email || undefined,
        phone: phone || undefined,
      });
      updateUser({ realName, email, phone });
      showToast('个人资料已成功保存更新');
    } catch {
      showToast('保存资料失败，请重试', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPwdError('新密码长度不能少于 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致');
      return;
    }
    if (!user) return;

    setPwdLoading(true);
    setPwdError('');
    try {
      await apiClient.post(`/users/${user.id}/reset-password`, {
        newPassword,
      });
      showToast('登录密码已更新，请妥善保管新凭证');
      setPwdDrawerOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setPwdError('密码修改失败，请重试');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
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
      <div>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E40AF] flex items-center justify-center">
            <UserCog className="w-4 h-4" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">个人信息管理</h2>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          管理当前登录账号的基本联络信息、查看授权归属与安全令牌轮转状态
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 左侧身份卡片 */}
        <div className="md:col-span-1 space-y-6">
          <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs text-center relative overflow-hidden">
            <div className="w-20 h-20 mx-auto rounded-full bg-[#1E40AF] text-white text-2xl font-bold flex items-center justify-center shadow-md shadow-blue-900/10 mb-4">
              {user?.realName?.[0] || user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <h3 className="font-bold text-base text-slate-900">{user?.realName || user?.username}</h3>
            <p className="text-xs text-slate-400 mt-0.5">@{user?.username}</p>

            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3 text-left text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">所属部门</span>
                <span className="font-medium text-slate-700">
                  {user?.department?.name || '研发技术中心'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">账号状态</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  正常 (ACTIVE)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">安全令牌版本</span>
                <span className="font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  v{user?.tokenVersion ?? 1}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">注册时间</span>
                <span className="text-slate-500">
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '-'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPwdDrawerOpen(true)}
              className="mt-6 w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-[#1E40AF]" />
              <span>修改登录密码</span>
            </button>
          </div>

          {/* 安全环境指标 */}
          <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Fingerprint className="w-4 h-4 text-[#1E40AF]" />
              <span>多重安全防护机制</span>
            </div>
            <ul className="space-y-2 text-[11px] text-slate-500">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>双 Token 滚动刷新机制 (30m / 7d)</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>密码 Argon2id 内存硬算法加盐存储</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>全自动审计写操作流水日志脱敏</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 右侧资料修改表单 */}
        <div className="md:col-span-2">
          <div className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-3 mb-5">
              编辑基本联系信息
            </h3>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  登录账号名（系统分配，不可更改）
                </label>
                <input
                  type="text"
                  disabled
                  value={user?.username || ''}
                  className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  真实姓名
                </label>
                <input
                  type="text"
                  value={realName}
                  onChange={(e) => setRealName(e.target.value)}
                  placeholder="请输入您的姓名"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  工作电子邮箱
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@autix.com"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  联系手机号
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="13800000000"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#1E40AF] hover:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? '保存中...' : '保存个人资料'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* 修改密码抽屉 Drawer */}
      <RightDrawer
        isOpen={pwdDrawerOpen}
        onClose={() => setPwdDrawerOpen(false)}
        title="修改个人登录密码"
        description="更新后现存登录会话将需要用新凭证重新登录"
        footer={
          <>
            <button
              type="button"
              onClick={() => setPwdDrawerOpen(false)}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={pwdLoading}
              onClick={handleSaveNewPassword}
              className="px-4 py-2 bg-[#1E40AF] hover:bg-blue-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {pwdLoading ? '提交中...' : '确认更新密码'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSaveNewPassword} className="space-y-4">
          {pwdError && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
              {pwdError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              新密码 *
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="请输入新的安全密码（不少于 6 位）"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              确认新密码 *
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入新密码以确认"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:bg-white"
              required
            />
          </div>
        </form>
      </RightDrawer>
    </div>
  );
}
