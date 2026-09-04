'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShieldCheck,
  Users,
  KeyRound,
  Network,
  FileText,
  UserCog,
  LogOut,
  LucideIcon,
  ChevronRight,
} from 'lucide-react';
import { SYSTEM_MENUS, MenuItem } from '@/config/menu-config';
import { usePermissions } from '@/hooks/use-permissions';
import { useAuthStore } from '@/stores/auth-store';

const iconMap: Record<string, LucideIcon> = {
  Users,
  ShieldCheck,
  KeyRound,
  Network,
  FileText,
  UserCog,
};

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { hasPermission, isSuperAdmin } = usePermissions();
  const { user, logout } = useAuthStore();

  const filteredMenus = SYSTEM_MENUS.filter((item: MenuItem) => {
    if (!item.permission) return true;
    return isSuperAdmin || hasPermission(item.permission);
  });

  return (
    <aside className="w-[272px] min-w-[272px] h-screen bg-white border-r border-slate-200/80 flex flex-col justify-between select-none z-30">
      {/* 顶部 Brand Header */}
      <div>
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-100 bg-slate-50/40">
          <div className="w-9 h-9 rounded-xl bg-[#1E40AF] flex items-center justify-center text-white shadow-sm shadow-blue-900/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-base text-slate-900 tracking-tight leading-tight block">
              Autix RBAC
            </span>
            <span className="text-[11px] text-slate-400 font-medium tracking-wide">
              安全管控中心
            </span>
          </div>
        </div>

        {/* 导航菜单区 */}
        <div className="px-3.5 py-4 space-y-1">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            系统管理与治理
          </div>

          <nav className="space-y-1">
            {filteredMenus.map((item) => {
              const Icon = iconMap[item.icon] || ShieldCheck;
              const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`);

              return (
                <Link
                  key={item.key}
                  href={item.path}
                  className={`group flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 text-[#1E40AF] font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        isActive
                          ? 'text-[#1E40AF]'
                          : 'text-slate-400 group-hover:text-slate-600'
                      }`}
                    />
                    <span>{item.title}</span>
                  </div>

                  {isActive ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1E40AF]" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 底部用户信息与快速注销 */}
      <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
        <div className="p-2.5 rounded-xl bg-white border border-slate-200/70 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0">
              {user?.realName?.[0] || user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-semibold text-slate-800 truncate">
                {user?.realName || user?.username || '当前用户'}
              </div>
              <div className="text-[10px] text-blue-600 font-medium truncate">
                {isSuperAdmin ? '超级管理员' : user?.roles?.[0]?.name || '操作员'}
              </div>
            </div>
          </div>

          <button
            onClick={() => logout()}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
