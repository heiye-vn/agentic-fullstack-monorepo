import { describe, it, expect, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';
import { PERMISSIONS_KEY, IS_PUBLIC_KEY } from '../src/common/decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';

describe('RBAC Guards & Decorators Test', () => {
  let reflector: Reflector;
  let permissionsGuard: PermissionsGuard;
  let jwtAuthGuard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    permissionsGuard = new PermissionsGuard(reflector);
    jwtAuthGuard = new JwtAuthGuard(reflector);
  });

  const createMockContext = (user?: any, requiredPermissions?: string[], isPublic?: boolean): ExecutionContext => {
    const handler = () => {};
    const targetClass = class {};

    if (requiredPermissions) {
      Reflect.defineMetadata(PERMISSIONS_KEY, requiredPermissions, handler);
    }
    if (isPublic) {
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    }

    return {
      getHandler: () => handler,
      getClass: () => targetClass,
      switchToHttp: () => ({
        getRequest: () => ({
          user,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('1. should allow access if no permissions are required', () => {
    const ctx = createMockContext({ roles: [], permissions: [] });
    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });

  it('2. should reject with 401 if user is not authenticated on protected route', () => {
    const ctx = createMockContext(undefined, ['sys:user:create']);
    expect(() => permissionsGuard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('3. should reject with 403 if user lacks required permission', () => {
    const ctx = createMockContext(
      { roles: ['viewer'], permissions: ['sys:user:list'] },
      ['sys:user:delete'],
    );
    expect(() => permissionsGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('4. should allow access if user has exact permission', () => {
    const ctx = createMockContext(
      { roles: ['operator'], permissions: ['sys:user:list', 'sys:user:create'] },
      ['sys:user:create'],
    );
    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });

  it('5. should allow access if user has wildcard permission (e.g. sys:user:*)', () => {
    const ctx = createMockContext(
      { roles: ['operator'], permissions: ['sys:user:*'] },
      ['sys:user:delete'],
    );
    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });

  it('6. should bypass permission checks for super_admin role', () => {
    const ctx = createMockContext(
      { roles: ['super_admin'], permissions: [] }, // 权限列表为空
      ['sys:critical:destroy', 'sys:finance:payout'],
    );
    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });

  it('7. should bypass permission checks for *:*:* global wildcard', () => {
    const ctx = createMockContext(
      { roles: ['custom_role'], permissions: ['*:*:*'] },
      ['sys:role:assign'],
    );
    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });

  it('8. JwtAuthGuard should allow public routes without authentication', () => {
    const ctx = createMockContext(undefined, undefined, true);
    expect(jwtAuthGuard.canActivate(ctx)).toBe(true);
  });
});
