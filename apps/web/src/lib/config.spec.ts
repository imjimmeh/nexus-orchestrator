import { describe, expect, it } from "vitest";
import {
  resolveRuntimeBaseUrlForPath,
  resolveRuntimeConfig,
  resolveRuntimeServiceTarget,
} from "./config";

describe("runtime config resolution", () => {
  it("falls back to /api for all services when config is missing", () => {
    const resolved = resolveRuntimeConfig(undefined);

    expect(resolved).toEqual({
      apiUrl: "/api",
      coreApiUrl: "/api",
      kanbanApiUrl: "/api",
      chatApiUrl: "/api",
    });
  });

  it("uses legacy apiUrl for all service endpoints when service URLs are not provided", () => {
    const resolved = resolveRuntimeConfig({
      apiUrl: "http://localhost:3010/api",
    });

    expect(resolved).toEqual({
      apiUrl: "http://localhost:3010/api",
      coreApiUrl: "http://localhost:3010/api",
      kanbanApiUrl: "http://localhost:3010/api",
      chatApiUrl: "http://localhost:3010/api",
    });
  });

  it("preserves service-specific URLs when configured", () => {
    const resolved = resolveRuntimeConfig({
      apiUrl: "http://localhost:3010/api",
      coreApiUrl: "http://localhost:3010/api",
      kanbanApiUrl: "http://localhost:3012/api",
      chatApiUrl: "http://localhost:3013/api",
    });

    expect(resolved.coreApiUrl).toBe("http://localhost:3010/api");
    expect(resolved.kanbanApiUrl).toBe("http://localhost:3012/api");
    expect(resolved.chatApiUrl).toBe("http://localhost:3013/api");
  });
});

describe("runtime route classification", () => {
  it("classifies kanban-owned project and work item routes as kanban", () => {
    expect(resolveRuntimeServiceTarget("/projects")).toBe("kanban");
    expect(resolveRuntimeServiceTarget("/projects/project-1")).toBe("kanban");
    expect(resolveRuntimeServiceTarget("/projects/project-1/work-items")).toBe(
      "kanban",
    );
    expect(
      resolveRuntimeServiceTarget("/projects/project-1/orchestration"),
    ).toBe("kanban");
    expect(
      resolveRuntimeServiceTarget("/projects/project-1/reviews/history"),
    ).toBe("kanban");
    expect(resolveRuntimeServiceTarget("/orchestration/action-requests")).toBe(
      "kanban",
    );
    expect(resolveRuntimeServiceTarget("/work-items")).toBe("kanban");
    expect(resolveRuntimeServiceTarget("/projects/project-1/goals")).toBe(
      "kanban",
    );
  });

  it("classifies routes by path even when a query string is present", () => {
    expect(
      resolveRuntimeServiceTarget(
        "/work-items?sortBy=updated_at&sortDir=desc&limit=50&offset=0",
      ),
    ).toBe("kanban");
    expect(
      resolveRuntimeServiceTarget("/projects/project-1/work-items?limit=50"),
    ).toBe("kanban");
    expect(resolveRuntimeServiceTarget("/workflows?status=running")).toBe(
      "core",
    );
  });

  it("keeps core-owned project collaboration and runtime routes on core", () => {
    expect(
      resolveRuntimeServiceTarget(
        "/projects/project-1/orchestration/war-room/sessions",
      ),
    ).toBe("core");
    expect(resolveRuntimeServiceTarget("/workflow-runtime/capabilities")).toBe(
      "core",
    );
  });

  it("classifies session routes as chat", () => {
    expect(resolveRuntimeServiceTarget("/sessions/chat")).toBe("chat");
    expect(resolveRuntimeServiceTarget("/sessions/chat/chat-1/events")).toBe(
      "chat",
    );
  });

  it("classifies non-chat session routes as core", () => {
    expect(resolveRuntimeServiceTarget("/sessions/ad-hoc")).toBe("core");
  });

  it("classifies chat collaboration subroutes as chat", () => {
    expect(resolveRuntimeServiceTarget("/sessions/chat/chat-1/state")).toBe(
      "chat",
    );
    expect(
      resolveRuntimeServiceTarget("/sessions/chat/chat-1/participants"),
    ).toBe("chat");
    expect(
      resolveRuntimeServiceTarget("/sessions/chat/chat-1/participants/invite"),
    ).toBe("chat");
    expect(
      resolveRuntimeServiceTarget("/sessions/chat/chat-1/telemetry-auth"),
    ).toBe("chat");
  });

  it("defaults other routes to core", () => {
    expect(resolveRuntimeServiceTarget("/workflows/runs")).toBe("core");
    expect(resolveRuntimeServiceTarget("/workflows/definitions")).toBe("core");
    expect(resolveRuntimeServiceTarget("/tools")).toBe("core");
    expect(resolveRuntimeServiceTarget("/users")).toBe("core");
    expect(resolveRuntimeServiceTarget("/admin/providers")).toBe("core");
    expect(resolveRuntimeServiceTarget("/ai-config/providers")).toBe("core");
    expect(resolveRuntimeServiceTarget("/operations/doctor")).toBe("core");
    expect(resolveRuntimeServiceTarget("/setup/status")).toBe("core");
    expect(resolveRuntimeServiceTarget("/notifications/inbox")).toBe("core");
    expect(resolveRuntimeServiceTarget("/auth/login")).toBe("core");
  });

  it("maps request path to the expected service base URL", () => {
    const resolved = resolveRuntimeConfig({
      coreApiUrl: "/core-api",
      kanbanApiUrl: "/kanban-api",
      chatApiUrl: "/chat-api",
    });

    expect(resolveRuntimeBaseUrlForPath(resolved, "/projects")).toBe(
      "/kanban-api",
    );
    expect(resolveRuntimeBaseUrlForPath(resolved, "/sessions/chat")).toBe(
      "/chat-api",
    );
    expect(resolveRuntimeBaseUrlForPath(resolved, "/workflows")).toBe(
      "/core-api",
    );
  });
});
