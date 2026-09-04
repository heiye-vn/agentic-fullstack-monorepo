import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  userId: string;
  username: string;
  realName?: string;
  departmentId?: string;
  roles: string[];
  permissions: string[];
  tokenVersion: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData | undefined;
    return data && user ? user[data] : user;
  },
);
