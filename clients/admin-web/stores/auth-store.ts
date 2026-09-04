import { create } from 'zustand';
import { User } from '@/types/auth';
import { apiClient } from '@/lib/api-client';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (data: {
    user: User;
    accessToken: string;
    refreshToken: string;
    permissions: string[];
  }) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  fetchProfileAndPermissions: () => Promise<void>;
  initAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  permissions: [],
  isAuthenticated: false,
  isLoading: true,

  initAuth: () => {
    if (typeof window === 'undefined') return;
    try {
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      const userStr = localStorage.getItem('currentUser');
      const permsStr = localStorage.getItem('userPermissions');

      const user = userStr ? JSON.parse(userStr) : null;
      const permissions = permsStr ? JSON.parse(permsStr) : [];

      if (accessToken && user) {
        set({
          accessToken,
          refreshToken,
          user,
          permissions,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  setAuth: ({ user, accessToken, refreshToken, permissions }) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('userPermissions', JSON.stringify(permissions));
    }
    set({
      user,
      accessToken,
      refreshToken,
      permissions,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  logout: async () => {
    try {
      const refreshToken = get().refreshToken;
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken }).catch(() => {});
      }
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('userPermissions');
        window.location.href = '/login';
      }
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        permissions: [],
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  updateUser: (updatedFields) => {
    const currentUser = get().user;
    if (!currentUser) return;
    const newUser = { ...currentUser, ...updatedFields };
    if (typeof window !== 'undefined') {
      localStorage.setItem('currentUser', JSON.stringify(newUser));
    }
    set({ user: newUser });
  },

  fetchProfileAndPermissions: async () => {
    try {
      const [profileRes, permRes] = await Promise.all([
        apiClient.get('/auth/me'),
        apiClient.get('/permissions/me'),
      ]);

      const user = profileRes.data.user || profileRes.data;
      const permissions = permRes.data.permissions || [];

      if (typeof window !== 'undefined') {
        localStorage.setItem('currentUser', JSON.stringify(user));
        localStorage.setItem('userPermissions', JSON.stringify(permissions));
      }

      set({ user, permissions });
    } catch (err) {
      console.error('Failed to fetch profile/permissions:', err);
    }
  },
}));
