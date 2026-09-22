import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Optional,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  assertSessionAlive,
  isStreamRoute,
  noopSessionStore,
  type SessionStore,
  type SessionSubject,
} from '../../security/session-check.js';

/**
 * 会话吊销校验的注入令牌。
 *
 * 默认不提供任何 Provider 时守卫走 noopSessionStore（放行），行为与改造前一致；
 * 生产环境在模块里 provide 一个真实实现（连 user-system 库或调 HTTP）即可生效：
 *
 *   providers: [{ provide: SESSION_STORE, useFactory: () => createTokenVersionStore(...) }]
 */
export const SESSION_STORE = Symbol('CHAT_SESSION_STORE');

export interface JwtAuthUser {
  userId: string;
  username: string;
  roles?: string[];
  permissions?: string[];
  /** 凭证版本号（第十八章：用于会话吊销校验） */
  tokenVersion?: number;
  /** 会话 ID（兼容位：本项目 user-system 暂未签发） */
  sessionId?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Optional() @Inject(SESSION_STORE) private readonly sessionStore?: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证凭证 (Bearer Token)');
    }

    let payload: Record<string, any>;
    try {
      const secret =
        process.env.JWT_SECRET ||
        'autix_rbac_jwt_secret_key_2026_super_secure';
      payload = await this.jwtService.verifyAsync(token, { secret });
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    const userId = payload.sub || payload.userId || payload.id;
    if (!userId) {
      throw new UnauthorizedException('Token 格式错误，缺少用户标识');
    }

    // 第十八章：验签通过 ≠ 会话还活着。登出/改密码后旧 token 必须立即失效。
    // 这一句放在 try 之外——它抛的是 401「会话已失效」，不能被验签的 catch 吞成
    // 「Token 无效或已过期」，否则排障时无法区分"签名坏了"和"被吊销了"。
    await assertSessionAlive(this.sessionStore ?? noopSessionStore, {
      userId,
      tokenVersion: typeof payload.tokenVersion === 'number' ? payload.tokenVersion : undefined,
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
    } satisfies SessionSubject);

    (request as any).user = {
      userId,
      username: payload.username,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      tokenVersion: payload.tokenVersion,
      sessionId: payload.sessionId,
    } satisfies JwtAuthUser;

    return true;
  }

  /**
   * 多来源提取 JWT，优先级依次为：
   *   1. Authorization: Bearer <token>   —— 常规 REST 请求
   *   2. Cookie: accessToken=<token>     —— 同源场景下的 SSE / 下载链接
   *   3. Query: ?token=<token>           —— EventSource 无法自定义请求头时的兜底方案
   *
   * 之所以需要 2/3：浏览器原生 EventSource API 不支持设置 Authorization 请求头，
   * 因此 SSE 长连接只能把 token 放在 URL 查询参数里传递。
   *
   * ⚠️ 第十八章收紧点：第 3 条**只对流式路由开放**。URL 里的 token 会落进
   * access 日志、浏览器历史和 Referer 头，属于凭据泄露面；
   * 非流式路由完全可以带 header，没有理由享受这个例外。
   */
  private extractToken(request: Request): string | undefined {
    // 1. Authorization: Bearer <token>
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [type, headerToken] = authHeader.split(' ');
      if (type === 'Bearer' && headerToken) return headerToken;
    }

    // 2. Cookie: accessToken=<token>
    const cookie = request.headers.cookie;
    if (cookie) {
      const match = /(?:^|;\s*)accessToken=([^;]+)/.exec(cookie);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }

    // 3. Query: ?token=<token>（兼容 ?access_token=）—— 仅流式路由
    const rawPath = request.originalUrl ?? request.url;
    if (!isStreamRoute(rawPath)) return undefined;

    const queryToken = request.query?.token ?? request.query?.access_token;
    if (typeof queryToken === 'string' && queryToken) return queryToken;

    return undefined;
  }
}
