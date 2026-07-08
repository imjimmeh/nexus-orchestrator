import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from './internal-service-scopes.decorator';

interface ServiceTokenPayload extends jwt.JwtPayload {
  role?: string;
  serviceScopes?: unknown;
}

@Injectable()
export class InternalServiceScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      INTERNAL_SERVICE_SCOPES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.parseBearerToken(request.headers.authorization);
    if (!token) {
      return true;
    }

    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new UnauthorizedException(
        'JWT_SECRET environment variable is required',
      );
    }

    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object') {
      throw new UnauthorizedException('Invalid internal service token');
    }

    const decodedPayload = decoded as ServiceTokenPayload;
    if (decodedPayload.role !== 'agent') {
      return true;
    }

    let verified: ServiceTokenPayload;
    try {
      verified = jwt.verify(token, secret) as ServiceTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid internal service token');
    }

    const grantedScopes = this.readServiceScopes(verified.serviceScopes);
    const missingScopes = requiredScopes.filter(
      (scope) => !grantedScopes.includes(scope),
    );

    if (missingScopes.length > 0) {
      throw new ForbiddenException(
        `Internal service token is missing required scopes: ${missingScopes.join(', ')}`,
      );
    }

    return true;
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

    const token = match[1].trim();
    return token.length > 0 ? token : null;
  }

  private readServiceScopes(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((scope): scope is string => typeof scope === 'string');
  }
}
