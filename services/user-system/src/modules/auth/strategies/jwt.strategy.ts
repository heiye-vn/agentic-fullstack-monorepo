import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CommonStatus } from '@prisma/client';
import { getJwtSecret } from '../../../common/jwt-secret.js';

export interface JwtPayload {
  sub: string;
  username: string;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // fail-fast：密钥缺失时启动即抛错，禁止硬编码回退（防止伪造超管令牌）
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('用户不存在或已被注销');
    }

    if (user.status !== CommonStatus.ACTIVE) {
      throw new UnauthorizedException('账号已被冻结');
    }

    // 凭证版本号校验：若当前用户的 tokenVersion 大于 Token 中的版本，强制失效
    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('权限已发生变更，请重新获取认证凭证');
    }

    // 聚合当前用户的角色代码与权限编码列表
    const roles: string[] = [];
    const permissionsSet = new Set<string>();

    for (const ur of user.userRoles) {
      if (ur.role.status === CommonStatus.ACTIVE && !ur.role.deletedAt) {
        roles.push(ur.role.code);
        for (const rp of ur.role.rolePermissions) {
          if (rp.permission.status === CommonStatus.ACTIVE) {
            permissionsSet.add(rp.permission.code);
          }
        }
      }
    }

    return {
      userId: user.id,
      username: user.username,
      realName: user.realName,
      departmentId: user.departmentId,
      roles,
      permissions: Array.from(permissionsSet),
      tokenVersion: user.tokenVersion,
    };
  }
}
