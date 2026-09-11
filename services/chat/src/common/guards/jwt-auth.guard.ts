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
    const token = this.extractTokenFromHeader(request);

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

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) return undefined;
    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
