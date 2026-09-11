import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtAuthUser } from '../guards/jwt-auth.guard.js';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtAuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtAuthUser | undefined;
    return data && user ? user[data] : user;
  },
);
