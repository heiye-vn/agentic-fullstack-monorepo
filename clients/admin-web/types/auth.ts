export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  leader?: string | null;
  phone?: string | null;
  email?: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Department[];
  userCount?: number;
}

export interface Permission {
  id: string;
  name: string;
  code: string;
  type: 'MENU' | 'BUTTON' | 'API';
  path?: string | null;
  component?: string | null;
  icon?: string | null;
  sort: number;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Permission[];
}

export interface Role {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  permissions?: Permission[];
  rolePermissions?: { permissionId: string }[];
  _count?: {
    userRoles: number;
    rolePermissions: number;
  };
}

export interface User {
  id: string;
  username: string;
  realName?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  status: UserStatus;
  departmentId?: string | null;
  department?: Department | null;
  tokenVersion: number;
  createdAt: string;
  updatedAt: string;
  roles?: Role[];
  userRoles?: { role: Role }[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  permissions: string[];
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface PaginatedResult<T> {
  items: T[];
  data?: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LoginLog {
  id: string;
  userId?: string | null;
  username: string;
  ip: string;
  userAgent?: string | null;
  status: 'SUCCESS' | 'FAILED';
  message?: string | null;
  createdAt: string;
}

export interface OperationLog {
  id: string;
  userId?: string | null;
  username: string;
  module: string;
  action: string;
  method: string;
  path: string;
  params?: string | null;
  status: number;
  duration: number;
  ip: string;
  createdAt: string;
}
