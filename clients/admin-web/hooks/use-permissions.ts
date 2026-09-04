import { useAuthStore } from '@/stores/auth-store';
import { Role } from '@/types/auth';

export function matchPermission(userPerm: string, requiredPerm: string): boolean {
  if (userPerm === '*:*:*' || userPerm === '*') {
    return true;
  }
  if (userPerm === requiredPerm) {
    return true;
  }

  // 支持冒号通配符: sys:user:* 匹配 sys:user:create
  const userParts = userPerm.split(':');
  const reqParts = requiredPerm.split(':');

  if (userParts.length > reqParts.length) {
    return false;
  }

  for (let i = 0; i < userParts.length; i++) {
    if (userParts[i] === '*') {
      return true;
    }
    if (userParts[i] !== reqParts[i]) {
      return false;
    }
  }

  return userParts.length === reqParts.length;
}

export function usePermissions() {
  const { permissions, user } = useAuthStore();

  const isSuperAdmin =
    user?.roles?.some((r: Role) => r.code === 'super_admin') ||
    user?.userRoles?.some((ur: { role: Role }) => ur.role.code === 'super_admin') ||
    permissions.includes('*:*:*');

  const hasPermission = (required: string): boolean => {
    if (isSuperAdmin) return true;
    return permissions.some((p: string) => matchPermission(p, required));
  };

  const hasAnyPermission = (requiredList: string[]): boolean => {
    if (isSuperAdmin) return true;
    return requiredList.some((req) => hasPermission(req));
  };

  const hasAllPermissions = (requiredList: string[]): boolean => {
    if (isSuperAdmin) return true;
    return requiredList.every((req) => hasPermission(req));
  };

  return {
    permissions,
    isSuperAdmin,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };
}
