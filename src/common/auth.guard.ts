import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UsersDirectory, type User } from './users.directory.js';

/** Restricts a route to the given roles (coarse check; per-quote authorization is in the service). */
export const Roles = Reflector.createDecorator<string[]>();

export type AuthedRequest = Request & { user?: User };

/**
 * STUB: identity = `x-user-id` header looked up in the configured directory (unknown → 401)
 * — prod: OIDC/JWT validated at the gateway, roles from IdP groups, mTLS for service callers.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(UsersDirectory) private readonly users: UsersDirectory,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['x-user-id'];
    const id = Array.isArray(header) ? header[0] : header;
    const user = id ? this.users.find(id.trim()) : undefined;
    if (!user) throw new UnauthorizedException('unknown or missing x-user-id');
    const roles = this.reflector.getAllAndOverride(Roles, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException(
        `role ${user.role} may not call this endpoint`,
      );
    }
    req.user = user;
    return true;
  }
}
