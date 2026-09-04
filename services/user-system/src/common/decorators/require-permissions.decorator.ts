import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'require_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const IS_PUBLIC_KEY = 'is_public_route';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
