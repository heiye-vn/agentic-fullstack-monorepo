export interface MenuItem {
  title: string;
  key: string;
  path: string;
  icon: string;
  permission?: string;
  badge?: string;
  children?: MenuItem[];
}

export const SYSTEM_MENUS: MenuItem[] = [
  {
    title: '用户管理',
    key: 'users',
    path: '/users',
    icon: 'Users',
    permission: 'sys:user:list',
  },
  {
    title: '角色管理',
    key: 'roles',
    path: '/roles',
    icon: 'ShieldCheck',
    permission: 'sys:role:list',
  },
  {
    title: '权限配置中心',
    key: 'permission-center',
    path: '/permission-center',
    icon: 'KeyRound',
    permission: 'sys:permission:list',
  },
  {
    title: '部门架构',
    key: 'departments',
    path: '/departments',
    icon: 'Network',
    permission: 'sys:dept:list',
  },
  {
    title: '审计中心',
    key: 'logs',
    path: '/logs',
    icon: 'FileText',
    permission: 'sys:log:list',
  },
  {
    title: '个人中心',
    key: 'profile',
    path: '/profile',
    icon: 'UserCog',
  },
];
