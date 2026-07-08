import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from "./internal-service-scopes.decorator";

export function hasAnyInternalOperatorRole(roles: readonly string[]): boolean {
  return roles.includes("Admin") || roles.includes("Developer");
}

@Injectable()
export class InternalServiceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.readRequiredScopes(context);
    const requiredToken = this.readRequiredToken();
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.parseBearerToken(request.headers.authorization);

    if (requiredToken && token === requiredToken) {
      return true;
    }

    const jwtSecret = this.readOptionalEnv("JWT_SECRET");
    if (requiredScopes.length > 0 && !requiredToken && !jwtSecret) {
      throw new UnauthorizedException(
        requiredScopes.includes("kanban:mcp")
          ? "MCP service auth must be configured"
          : "Internal service auth must be configured",
      );
    }

    if (jwtSecret && token) {
      this.verifyJwtServiceIdentity(token, jwtSecret, requiredScopes);
      return true;
    }

    if (requiredToken || jwtSecret) {
      throw new UnauthorizedException("Invalid internal service token");
    }

    return true;
  }

  private readRequiredToken(): string | null {
    const token = process.env.KANBAN_SERVICE_BEARER_TOKEN;
    if (typeof token !== "string") {
      return null;
    }

    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== "string") {
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

  private verifyJwtServiceIdentity(
    token: string,
    secret: string,
    requiredScopes: string[],
  ): void {
    const audience =
      this.readOptionalEnv("KANBAN_SERVICE_JWT_AUDIENCE") ??
      "nexus-kanban-service";
    const issuer =
      this.readOptionalEnv("KANBAN_SERVICE_JWT_ISSUER") ?? undefined;

    try {
      const payload = jwt.verify(token, secret, {
        audience,
        ...(issuer ? { issuer } : {}),
      }) as jwt.JwtPayload;

      this.assertAgentIdentity(payload);
      this.assertRoleClaims(payload);
      this.assertRequiredScopes(payload, requiredScopes);
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new UnauthorizedException("Invalid internal service token");
    }
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
      .filter((scope): scope is string => typeof scope === "string")
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  private assertAgentIdentity(payload: jwt.JwtPayload): void {
    if (payload.role !== "agent") {
      throw new UnauthorizedException(
        "Internal service token must be an agent token",
      );
    }
  }

  private assertRoleClaims(payload: jwt.JwtPayload): void {
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((item): item is string => typeof item === "string")
      : [];

    if (!hasAnyInternalOperatorRole(roles)) {
      throw new UnauthorizedException(
        "Internal service token is missing required roles",
      );
    }
  }

  private assertRequiredScopes(
    payload: jwt.JwtPayload,
    requiredScopes: string[],
  ): void {
    const grantedScopes = Array.isArray(payload.serviceScopes)
      ? payload.serviceScopes.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const missingScopes = requiredScopes.filter(
      (scope) => !grantedScopes.includes(scope),
    );

    if (missingScopes.length > 0) {
      throw new ForbiddenException(
        `Internal service token is missing required scopes: ${missingScopes.join(", ")}`,
      );
    }
  }

  private parseBearerToken(
    header: string | string[] | undefined,
  ): string | null {
    if (typeof header !== "string") {
      return null;
    }

    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      return null;
    }

    const token = match[1].trim();
    return token.length > 0 ? token : null;
  }
}
