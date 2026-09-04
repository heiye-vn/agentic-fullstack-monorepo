'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Lock, User, Eye, EyeOff, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin123!');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('请输入账号和密码');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await apiClient.post('/auth/login', {
        username: username.trim(),
        password,
        deviceId: 'browser-admin-client',
      });

      const { accessToken, refreshToken, user } = res.data;

      // 立即调用 /permissions/me 获取用户动态菜单和按钮权限清单
      let permissions: string[] = [];
      try {
        const permRes = await apiClient.get('/permissions/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        permissions = permRes.data.permissions || [];
      } catch (pErr) {
        console.warn('Failed to fetch permissions on login:', pErr);
      }

      setAuth({ accessToken, refreshToken, user, permissions });

      router.push('/users');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setErrorMsg(error.response?.data?.message || '登录失败，请检查账号密码或后端服务');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillAccount = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setErrorMsg('');
  };

  return (
    <div className="min-h-screen flex items-stretch bg-slate-50 selection:bg-blue-600 selection:text-white">
      {/* 左侧品牌视觉区 (Modern Deep Blue SaaS Hero) */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#1E40AF] text-white p-12 flex-col justify-between relative overflow-hidden">
        {/* 背景现代几何微光装饰 */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

        {/* 顶部 Logo 与系统标识 */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight">Autix Cloud</h1>
            <p className="text-xs text-blue-200">企业级多租户安全权限管理引擎</p>
          </div>
        </div>

        {/* 中间核心价值亮点 */}
        <div className="relative z-10 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs text-blue-100 backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-blue-300" />
            <span>三位一体 RBAC 细粒度控制中心</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight leading-snug">
            统一身份认证与<br />
            动态多维权限控制架构
          </h2>
          <p className="text-sm text-blue-100/80 leading-relaxed">
            支持用户生命周期、组织架构级联管控、双 Token 滚动刷新机制以及毫秒级权限版本懒刷新，保障核心资产安全。
          </p>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs">
              <div className="flex items-center gap-2 text-white font-medium text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                双 Token 自动轮转
              </div>
              <p className="text-xs text-blue-200/70 mt-1">防重放与即时吊销能力</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs">
              <div className="flex items-center gap-2 text-white font-medium text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                按钮级鉴权中枢
              </div>
              <p className="text-xs text-blue-200/70 mt-1">通配符与超管智能旁路</p>
            </div>
          </div>
        </div>

        {/* 底部版权与版本信息 */}
        <div className="relative z-10 text-xs text-blue-200/60 flex items-center justify-between border-t border-white/10 pt-4">
          <span>&copy; 2026 Autix Platform. All rights reserved.</span>
          <span>v1.0.0 Enterprise</span>
        </div>
      </div>

      {/* 右侧表单交互区 (Clean & Crisp Modern Form) */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8 bg-white p-8 sm:p-10 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <div className="lg:hidden flex items-center gap-2.5 mb-6">
              <div className="w-9 h-9 rounded-lg bg-[#1E40AF] flex items-center justify-center text-white">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg text-slate-900">Autix Cloud</span>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-slate-900">欢迎登录系统</h2>
            <p className="text-sm text-slate-500 mt-1.5">请输入您的工作凭证以访问管理控制台</p>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/80 text-xs text-red-700 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                账号名称
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                登录密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入登录密码"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/60 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 px-4 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-medium text-sm rounded-xl shadow-md shadow-blue-900/10 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>安全登录中...</span>
                </div>
              ) : (
                <>
                  <span>立即登录</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* 快捷测试账号填充 */}
          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-400 mb-2.5 text-center">快捷填入预设测试账号：</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                onClick={() => handleFillAccount('admin', 'Admin123!')}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 rounded-lg border border-slate-200/80 transition-colors cursor-pointer"
              >
                超级管理员 (admin)
              </button>
              <button
                type="button"
                onClick={() => handleFillAccount('test_ops', 'Admin123!')}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 rounded-lg border border-slate-200/80 transition-colors cursor-pointer"
              >
                测试运维账号
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
