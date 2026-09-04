'use client';

import React, { useEffect } from 'react';
import { ToastProvider } from '@heroui/react';
import { useAuthStore } from '@/stores/auth-store';

export function Providers({ children }: { children: React.ReactNode }) {
  const initAuth = useAuthStore((state) => state.initAuth);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <>
      <ToastProvider />
      {children}
    </>
  );
}
