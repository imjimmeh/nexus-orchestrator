import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from './internal-service-scopes.decorator';

type RequestUser = {
  userId: string;
  roles: string[];
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

const CHAT_SERVICE_ROLE_NAMES = ['admin', 'developer'] as const;
const CHAT_USER_ROLE_NAMES = ['admin', 'user', 'developer'] as const;

@Injectable()
export class ChatClientAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.parseBearerToken(request.headers.authorization);
    const requiredScopes = this.readRequiredScopes(context);

    const requiredToken = this.readRequiredToken();
    if (requiredToken && token === requiredToken) {
      request.user = {
        userId: 'chat-service-static-token',
        roles: ['Admin', 'Developer'],
      };
      return true;
    }

    const jwtSecret = this.readOptionalEnv('JWT_SECRET');
    if (jwtSecret && token) {
      this.verifyJwtIdentity(request, token, jwtSecret, requiredScopes);
      return true;
    }

    if (requiredToken || jwtSecret) {
      throw new UnauthorizedException('Invalid chat authentication token');
    }

    return true;
  }

  private verifyJwtIdentity(
    request: RequestWithUser,
    token: string,
    secret: string,
    requiredScopes: string[],
  ): void {
    try {
      const payload = jwt.verify(token, secret) as jwt.JwtPayload;
      const roles = this.readRoles(payload);

      if (payload.role === 'agent') {
        this.assertServiceRoles(roles);
        this.assertRequiredScopes(payload, requiredScopes);
      } else {
        this.assertUserRoles(roles);
      }

      request.user = {
        userId:
          typeof payload.sub === 'string' && payload.sub.trim().length > 0
            ? payload.sub
            : 'unknown',
        roles,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new UnauthorizedException('Invalid chat authentication token');
    }
  }

  private readRequiredToken(): string | null {
    const token = process.env.CHAT_SERVICE_BEARER_TOKEN;
    if (typeof token !== 'string') {
      return null;
    }

    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private readRequiredScopes(context: ExecutionContext): string[] {
    const classScopes = this.readScopeMetadata(context.getClass());
    const handlerScopes = this.readScopeMetadata(context.getHandler());
    return [...new Set([...classScopes, ...handlerScopes])];
  }

  private readScopeMetadata(target: object): string[] {
    const metadata: unknown = Reflect.getMetadata(
      INTERNAL_SERVICE_SCOPES_METADATA_KEY,
      target,
    );
    if (!Array.isArray(metadata)) {
      return [];
    }

    return metadata
      .filter((scope): scope is string => typeof scope === 'string')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  private readRoles(payload: jwt.JwtPayload): string[] {
    if (!Array.isArray(payload.roles)) {
      return [];
    }

    return payload.roles.filter(
      (item): item is string => typeof item === 'string',
    );
  }

  private assertServiceRoles(roles: string[]): void {
    const normalizedRoles = this.normalizeRoles(roles);
    if (
      !normalizedRoles.includes(CHAT_SERVICE_ROLE_NAMES[0]) ||
      !normalizedRoles.includes(CHAT_SERVICE_ROLE_NAMES[1])
    ) {
      throw new UnauthorizedException(
        'Internal service token is missing required roles',
      );
    }
  }

  private assertUserRoles(roles: string[]): void {
    const normalizedRoles = this.normalizeRoles(roles);
    const hasRecognizedUserRole = CHAT_USER_ROLE_NAMES.some((role) =>
      normalizedRoles.includes(role),
    );

    if (!hasRecognizedUserRole) {
      throw new UnauthorizedException(
        'User token is missing required chat roles',
      );
    }
  }

  private normalizeRoles(roles: string[]): string[] {
    return roles
      .map((role) => role.trim().toLowerCase())
      .filter((role) => role.length > 0);
  }

  private assertRequiredScopes(
    payload: jwt.JwtPayload,
    requiredScopes: string[],
  ): void {
    if (requiredScopes.length === 0) {
      return;
    }

    const grantedScopes = Array.isArray(payload.serviceScopes)
      ? payload.serviceScopes.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    const missingScopes = requiredScopes.filter(
      (scope) => !grantedScopes.includes(scope),
    );

    if (missingScopes.length > 0) {
      throw new ForbiddenException(
        `Internal service token is missing required scopes: ${missingScopes.join(
          ', ',
        )}`,
      );
    }
  }

  private parseBearerToken(
    header: string | string[] | undefined,
  ): string | null {
    if (typeof header !== 'string') {
      return null;
    }

    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      return null;
    }

    const parsedToken = match[1].trim();
    return parsedToken.length > 0 ? parsedToken : null;
  }
}
