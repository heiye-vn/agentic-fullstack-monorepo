import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface JwtAuthUser {
  userId: string;
  username: string;
  roles?: string[];
  permissions?: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证凭证 (Bearer Token)');
    }

    try {
      const secret =
        process.env.JWT_SECRET ||
        'autix_rbac_jwt_secret_key_2026_super_secure';
      const payload = await this.jwtService.verifyAsync(token, {
        secret,
      });

      const userId = payload.sub || payload.userId || payload.id;
      if (!userId) {
        throw new UnauthorizedException('Token 格式错误，缺少用户标识');
      }

      (request as any).user = {
        userId,
        username: payload.username,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
      } satisfies JwtAuthUser;
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }

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

    // 3. Query: ?token=<token>（兼容 ?access_token=）
    const queryToken = request.query?.token ?? request.query?.access_token;
    if (typeof queryToken === 'string' && queryToken) return queryToken;

    return undefined;
  }
}
