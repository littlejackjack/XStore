import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { User } from '../../database/entities/user.entity';

/** Injects the authenticated user (or a single field of it) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<{ user?: User }>();
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.user;
  },
);
