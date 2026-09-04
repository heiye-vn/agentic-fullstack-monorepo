'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  RefreshCw,
  User,
  Shield,
  ChevronDown,
  LogOut,
  CheckCircle2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissions } from '@/hooks/use-permissions';

const pageTitleMap: Record<string, string> = {
  '/users': '用户管理中心',
  '/roles': '角色管理中心',
  '/permission-center': '权限配置中心',
  '/departments': '组织架构与部门',
  '/logs': '审计与合规流水',
  '/profile': '个人信息管理',
};

export const Header: React.FC = () => {
  const pathname = usePathname();
  const { user, logout, fetchProfileAndPermissions } = useAuthStore();
  const { isSuperAdmin } = usePermissions();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);

  const currentTitle = pageTitleMap[pathname] || '管理控制台';

  const handleRefreshPerms = async () => {
    setIsRefreshing(true);
    try {
      await fetchProfileAndPermissions();
      setRefreshSuccess(true);
      setTimeout(() => setRefreshSuccess(false), 2000);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between sticky top-0 z-20">
      {/* 左侧当前标题与路径 */}
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-slate-800 tracking-tight">
          {currentTitle}
        </h1>
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/60 text-[11px] font-medium text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>服务联通中 (Port 4002)</span>
        </div>
      </div>

      {/* 右侧操作区 */}
      <div className="flex items-center gap-3">
        {/* 同步刷新权限状态按钮 */}
        <button
          onClick={handleRefreshPerms}
          disabled={isRefreshing}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
            refreshSuccess
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
          }`}
          title="重新同步最新角色与权限"
        >
          {refreshSuccess ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>已最新</span>
            </>
          ) : (
            <>
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>刷新权限</span>
            </>
          )}
        </button>

        <button
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"
          title="系统消息"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full" />
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        {/* 用户信息下拉菜单 */}
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2.5 pl-1.5 pr-2 py-1 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-[#1E40AF] text-white text-xs font-semibold flex items-center justify-center shadow-xs">
              {user?.realName?.[0] || user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="text-left hidden md:block">
              <p className="text-xs font-semibold text-slate-800 leading-tight">
                {user?.realName || user?.username || '管理员'}
              </p>
              <p className="text-[10px] text-slate-400">
                {isSuperAdmin ? '超级管理员' : '系统用户'}
              </p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {showDropdown && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowDropdown(false)}
              />
              <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-slate-200/80 shadow-lg py-1.5 z-50 animate-fadeIn">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-800">
                    {user?.realName || user?.username}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {user?.email || '未绑定邮箱'}
                  </p>
                </div>

                <div className="py-1">
                  <Link
                    href="/profile"
                    onClick={() => setShowDropdown(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>个人中心</span>
                  </Link>
                  <Link
                    href="/permission-center"
                    onClick={() => setShowDropdown(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Shield className="w-3.5 h-3.5 text-slate-400" />
                    <span>权限配置中心</span>
                  </Link>
                </div>

                <div className="border-t border-slate-100 pt-1">
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 text-red-500" />
                    <span>退出登录</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
