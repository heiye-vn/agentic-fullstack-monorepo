'use client';

import React from 'react';
import { usePermissions } from '@/hooks/use-permissions';

interface AuthGuardProps {
  permission: string | string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({
  permission,
  fallback = null,
  children,
}) => {
  const { hasPermission, hasAnyPermission } = usePermissions();

  const isAllowed = Array.isArray(permission)
    ? hasAnyPermission(permission)
    : hasPermission(permission);

  if (!isAllowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
