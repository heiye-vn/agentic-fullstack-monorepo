import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 若当前路由未声明任何权限限制，直接放行
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new UnauthorizedException('请求未携带有效认证信息');
    }

    // 1. 超级管理员角色绕过机制 (Super Admin Bypass)
    const userRoles: string[] = user.roles || [];
    if (userRoles.includes('super_admin')) {
      return true;
    }

    // 2. 全局通配符权限绕过机制
    const userPermissions: string[] = user.permissions || [];
    if (userPermissions.includes('*:*:*') || userPermissions.includes('*')) {
      return true;
    }

    // 3. 校验所需权限码 (支持通配符匹配，例如 sys:user:* 匹配 sys:user:create)
    const missingPermissions = requiredPermissions.filter(
      (required) => !this.hasPermission(userPermissions, required),
    );

    if (missingPermissions.length > 0) {
      throw new ForbiddenException(
        `操作权限不足，缺失权限标识: [${missingPermissions.join(', ')}]`,
      );
    }

    return true;
  }

  /**
   * 检查用户权限集合中是否命中所需权限码
   */
  private hasPermission(userPermissions: string[], required: string): boolean {
    return userPermissions.some((perm) => {
      if (perm === required) return true;
      // 前缀通配符，例如 sys:user:* 匹配 sys:user:list
      if (perm.endsWith(':*')) {
        const prefix = perm.slice(0, -2);
        return required.startsWith(prefix);
      }
      return false;
    });
  }
}
