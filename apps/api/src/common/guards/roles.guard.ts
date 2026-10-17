import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../decorators/roles.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { User } from '../../database/entities/user.entity';

const ROLE_WEIGHT: Record<Role, number> = { USER: 0, ADMIN: 1, SUPER_ADMIN: 2 };

/** Role-based access control. Higher roles inherit lower permissions. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: User }>();
    if (!user) throw new ForbiddenException('Authentication required');

    const minimum = Math.min(...requiredRoles.map((role) => ROLE_WEIGHT[role]));
    if (ROLE_WEIGHT[user.role] < minimum) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
