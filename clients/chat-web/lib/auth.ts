export const AUTH_CHANGED_EVENT = 'autix:auth-changed';

export function getStoredUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('chat_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: any) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('chat_user', JSON.stringify(user));
  notifyAuthChanged();
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('chat_user');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  notifyAuthChanged();
}

/**
 * 广播认证状态变更（登录 / 登出 / token 刷新）。
 * 监听方（如 useTaskEvents）据此重建或断开 SSE 长连接，
 * 取代原先每秒轮询 localStorage 的做法。
 */
export function notifyAuthChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
