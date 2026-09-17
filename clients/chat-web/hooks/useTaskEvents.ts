import { useEffect, useRef, useCallback, useState } from 'react';
import { TaskEvent, userApi } from '../lib/api';
import { AUTH_CHANGED_EVENT } from '../lib/auth';

// 直接连接后端，绕过 Next.js rewrites 代理（Next.js 对 SSE 长连接存在缓冲/超时问题）
const SSE_PATH = `${process.env.NEXT_PUBLIC_CHAT_API_URL ?? 'http://localhost:4001'}/api/sse/tasks`;

/** 首次重连延迟，之后按 2 的幂次递增 */
const BASE_RETRY_DELAY = 3000;
/** 退避上限，避免后期间隔过长失去意义 */
const MAX_RETRY_DELAY = 30_000;
/** 连续失败达到该次数后放弃重连 */
const MAX_CONSECUTIVE_FAILURES = 6;
/**
 * 每连续失败这么多次，主动探测一次 token 是否仍然有效。
 * 原因：浏览器 EventSource 只对连接错误抛出笼统的 onerror，拿不到 HTTP 状态码，
 * 无法直接区分「token 过期(401)」与「网络抖动」。不探测就只能盲目重连。
 */
const PROBE_AFTER_FAILURES = 3;

export function useTaskEvents(
  onEvent: (event: TaskEvent) => void,
  options?: { onConnected?: () => void }
) {
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 连续失败计数，连接成功后归零 */
  const failureCountRef = useRef(0);
  /** 探测 token 期间避免并发发起多个探测请求 */
  const probingRef = useRef(false);
  /** 判定 token 已失效后彻底停手，不再重连 */
  const stoppedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const onEventRef = useRef(onEvent);
  const onConnectedRef = useRef(options?.onConnected);
  const [hasToken, setHasToken] = useState(false);

  // Keep refs current so closures inside connect() always call the latest callbacks
  // 必须在 useEffect 中赋值，React 19 禁止在渲染阶段写入 ref
  useEffect(() => {
    onEventRef.current = onEvent;
    onConnectedRef.current = options?.onConnected;
  });

  // 监听 token 变化：登录/登出/刷新都会广播该事件，取代每秒轮询
  useEffect(() => {
    const checkToken = () => setHasToken(!!localStorage.getItem('accessToken'));

    checkToken();

    // storage 事件：跨标签页同步
    window.addEventListener('storage', checkToken);
    // 自定义事件：同一标签页内的登录/登出/refresh
    window.addEventListener(AUTH_CHANGED_EVENT, checkToken);

    return () => {
      window.removeEventListener('storage', checkToken);
      window.removeEventListener(AUTH_CHANGED_EVENT, checkToken);
    };
  }, []);

  const scheduleReconnect = useCallback((delay: number) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      if (stoppedRef.current) return;
      // token 已被清除（登出或 refresh 失败）→ 没必要再连
      if (!localStorage.getItem('accessToken')) return;
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    const token = localStorage.getItem('accessToken');

    // 如果没有 token，不建立连接
    if (!token) {
      console.log('[useTaskEvents] No token found, skipping SSE connection');
      return;
    }

    const url = `${SSE_PATH}?token=${encodeURIComponent(token)}`;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.addEventListener('task', (e) => {
      try {
        const event: TaskEvent = JSON.parse(e.data);
        onEventRef.current(event);
      } catch {
        console.error('[useTaskEvents] failed to parse event data');
      }
    });

    source.addEventListener('connected', () => {
      // 连接真正建立，清空失败计数，退避重新从 BASE 开始
      failureCountRef.current = 0;
      onConnectedRef.current?.();
    });

    source.onerror = async () => {
      // 必须第一时间 close：EventSource 对非 2xx 响应有内建自动重连，
      // 若不先关掉，浏览器重连会与下面的手动重连叠加成两路心跳。
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
      if (stoppedRef.current) return;

      failureCountRef.current += 1;
      const failures = failureCountRef.current;

      // 每 PROBE_AFTER_FAILURES 次探测一次 token 有效性
      if (failures % PROBE_AFTER_FAILURES === 0 && !probingRef.current) {
        probingRef.current = true;
        try {
          await userApi.get('/auth/me');
          // token 仍然有效（或已被 axios 拦截器 refresh 救回）→ 立即重连，不必再等退避
          failureCountRef.current = 0;
          probingRef.current = false;
          scheduleReconnect(0);
          return;
        } catch {
          probingRef.current = false;
          // refresh 失败时 api 层会 clearAuth() 并跳转登录，此时 token 已被移除
          if (!localStorage.getItem('accessToken')) {
            console.warn('[useTaskEvents] token 已失效，停止 SSE 重连');
            stoppedRef.current = true;
            return;
          }
          // token 还在，说明只是探测请求本身出错（网络问题），继续走退避
        }
      }

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[useTaskEvents] 连续失败 ${failures} 次，停止重连（刷新页面或重新登录可恢复）`,
        );
        stoppedRef.current = true;
        return;
      }

      // 指数退避：3s → 6s → 12s → 24s → 30s(封顶)
      const delay = Math.min(
        BASE_RETRY_DELAY * 2 ** (failures - 1),
        MAX_RETRY_DELAY,
      );
      console.warn(
        `[useTaskEvents] SSE error (第 ${failures} 次)，${delay}ms 后重连...`,
      );
      scheduleReconnect(delay);
    };
  }, [scheduleReconnect]);

  // connectRef 始终指向最新的 connect，供 scheduleReconnect 回调
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    // 清理之前的连接
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // 重新挂载 / token 重新出现时，允许再次重连
    stoppedRef.current = false;
    failureCountRef.current = 0;

    // 只有在有 token 时才建立连接
    if (hasToken) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      sourceRef.current?.close();
    };
  }, [connect, hasToken]);
}
