import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanPermissionsGuard } from "./kanban-permissions.guard";
import { KANBAN_REQUIRED_PERMISSION_KEY } from "./require-permission.decorator";

const PROJECT_ID = "proj-uuid-1234";
const BEARER_TOKEN = "Bearer user-jwt-token";
const CORE_BASE_URL = "http://localhost:3010/api";

function buildContext(options: {
  permission?: string;
  authorization?: string;
  projectId?: string;
}): ExecutionContext {
  const handler = vi.fn();
  const controller = function Controller() {};

  if (options.permission !== undefined) {
    Reflect.defineMetadata(
      KANBAN_REQUIRED_PERMISSION_KEY,
      options.permission,
      handler,
    );
  }

  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          authorization: options.authorization,
        },
        params: {
          project_id: options.projectId ?? PROJECT_ID,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

function buildFetchResponse(
  ok: boolean,
  body: { scopeNodeId: string; permissions: string[] },
): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("KanbanPermissionsGuard", () => {
  let guard: KanbanPermissionsGuard;

  beforeEach(() => {
    process.env.KANBAN_CORE_BASE_URL = CORE_BASE_URL;
    guard = new KanbanPermissionsGuard(new Reflector());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KANBAN_CORE_BASE_URL;
  });

  it("allows when no permission metadata is set", async () => {
    const context = buildContext({ authorization: BEARER_TOKEN });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies when Authorization header is absent", async () => {
    const context = buildContext({
      permission: "goals:read",
      authorization: undefined,
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  it("denies when Core responds with non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildFetchResponse(false, {
          scopeNodeId: PROJECT_ID,
          permissions: [],
        }),
      ),
    );

    const context = buildContext({
      permission: "goals:read",
      authorization: BEARER_TOKEN,
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  it("allows when the exact required permission is present in Core response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildFetchResponse(true, {
          scopeNodeId: PROJECT_ID,
          permissions: ["goals:read"],
        }),
      ),
    );

    const context = buildContext({
      permission: "goals:read",
      authorization: BEARER_TOKEN,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("allows when the manage wildcard permission is present in Core response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildFetchResponse(true, {
          scopeNodeId: PROJECT_ID,
          permissions: ["goals:manage"],
        }),
      ),
    );

    const context = buildContext({
      permission: "goals:read",
      authorization: BEARER_TOKEN,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies when fetch throws (Core unreachable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const context = buildContext({
      permission: "goals:read",
      authorization: BEARER_TOKEN,
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});
