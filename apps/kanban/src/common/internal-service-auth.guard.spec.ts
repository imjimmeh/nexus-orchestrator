import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasAnyInternalOperatorRole,
  InternalServiceAuthGuard,
} from "./internal-service-auth.guard";
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from "./internal-service-scopes.decorator";

const scopedHandler = (): void => {
  return;
};

const unscopedHandler = (): void => {
  return;
};

class ScopedController {
  protected readonly _marker = "scoped-controller";
}

Reflect.defineMetadata(
  INTERNAL_SERVICE_SCOPES_METADATA_KEY,
  ["kanban.core-events:write"],
  scopedHandler,
);

describe("InternalServiceAuthGuard", () => {
  const previousStaticToken = process.env.KANBAN_SERVICE_BEARER_TOKEN;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousAudience = process.env.KANBAN_SERVICE_JWT_AUDIENCE;
  const previousIssuer = process.env.KANBAN_SERVICE_JWT_ISSUER;

  afterEach(() => {
    process.env.KANBAN_SERVICE_BEARER_TOKEN = previousStaticToken;
    process.env.JWT_SECRET = previousJwtSecret;
    process.env.KANBAN_SERVICE_JWT_AUDIENCE = previousAudience;
    process.env.KANBAN_SERVICE_JWT_ISSUER = previousIssuer;
  });

  it("accepts static service token", () => {
    process.env.KANBAN_SERVICE_BEARER_TOKEN = "kanban-internal-token";
    process.env.JWT_SECRET = "";

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext("Bearer kanban-internal-token");

    expect(guard.canActivate(context)).toBe(true);
  });

  it("accepts JWT service token", () => {
    process.env.KANBAN_SERVICE_BEARER_TOKEN = "";
    const jwtSecret = randomUUID();
    process.env.JWT_SECRET = jwtSecret;
    process.env.KANBAN_SERVICE_JWT_AUDIENCE = "nexus-kanban-service";
    process.env.KANBAN_SERVICE_JWT_ISSUER = "nexus-api";

    const token = jwt.sign(
      {
        role: "agent",
        roles: ["Admin", "Developer"],
      },
      jwtSecret,
      {
        subject: "api-service",
        audience: "nexus-kanban-service",
        issuer: "nexus-api",
        expiresIn: "5m",
      },
    );

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext(`Bearer ${token}`);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects JWT service token that is missing required route scopes", () => {
    process.env.KANBAN_SERVICE_BEARER_TOKEN = "";
    const jwtSecret = randomUUID();
    process.env.JWT_SECRET = jwtSecret;
    process.env.KANBAN_SERVICE_JWT_AUDIENCE = "nexus-kanban-service";
    process.env.KANBAN_SERVICE_JWT_ISSUER = "nexus-api";

    const token = jwt.sign(
      {
        role: "agent",
        roles: ["Admin", "Developer"],
        serviceScopes: ["kanban.core-events:read"],
      },
      jwtSecret,
      {
        subject: "api-service",
        audience: "nexus-kanban-service",
        issuer: "nexus-api",
        expiresIn: "5m",
      },
    );

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext(
      `Bearer ${token}`,
      scopedHandler,
      ScopedController,
    );

    expect(() => guard.canActivate(context)).toThrow(
      /missing required scopes/i,
    );
  });

  it("rejects MCP requests when no static bearer token or JWT secret is configured", () => {
    process.env.KANBAN_SERVICE_BEARER_TOKEN = "";
    process.env.JWT_SECRET = "";

    const mcpHandler = (): void => {
      return;
    };
    Reflect.defineMetadata(
      INTERNAL_SERVICE_SCOPES_METADATA_KEY,
      ["kanban:mcp"],
      mcpHandler,
    );

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext("", mcpHandler, ScopedController);

    expect(() => guard.canActivate(context)).toThrow(
      /MCP service auth must be configured/i,
    );
  });

  it("rejects scoped internal routes when no static bearer token or JWT secret is configured", () => {
    process.env.KANBAN_SERVICE_BEARER_TOKEN = "";
    process.env.JWT_SECRET = "";

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext("", scopedHandler, ScopedController);

    expect(() => guard.canActivate(context)).toThrow(
      /Internal service auth must be configured/i,
    );
  });

  it.each([
    [["Admin"], true],
    [["Developer"], true],
    [["Admin", "Developer"], true],
    [["Viewer"], false],
    [[], false],
  ])("evaluates internal operator roles %j", (roles, expected) => {
    expect(hasAnyInternalOperatorRole(roles)).toBe(expected);
  });
});

function buildExecutionContext(
  authorization: string,
  handler: (...args: unknown[]) => unknown = unscopedHandler,
  controllerClass: new (...args: unknown[]) => unknown = ScopedController,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          authorization,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}
