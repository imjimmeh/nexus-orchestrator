import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { InternalServiceAuthTokenProvider } from "./core-client.types";

export const KANBAN_CORE_SERVICE_SCOPES = [
  "core.events:write",
  "core.domain-events:write",
  "core.workflow-runs:read",
  "core.workflow-runs:write",
  "core.secrets:read",
  "core.models:read",
] as const;

@Injectable()
export class KanbanCoreAuthTokenProvider implements InternalServiceAuthTokenProvider {
  resolveAuthorizationHeader(): string {
    const staticToken = this.readOptionalEnv("KANBAN_CORE_BEARER_TOKEN");
    if (staticToken) {
      return `Bearer ${staticToken}`;
    }

    const secret =
      this.readOptionalEnv("KANBAN_CORE_JWT_SECRET") ??
      this.readOptionalEnv("JWT_SECRET");
    if (!secret) {
      throw new Error(
        "Kanban Core auth requires KANBAN_CORE_BEARER_TOKEN or KANBAN_CORE_JWT_SECRET",
      );
    }

    const audience =
      this.readOptionalEnv("KANBAN_CORE_JWT_AUDIENCE") ?? "nexus-core-internal";
    const issuer =
      this.readOptionalEnv("KANBAN_CORE_JWT_ISSUER") ?? "nexus-kanban";
    const expiresIn = (this.readOptionalEnv("KANBAN_CORE_JWT_TTL") ??
      "5m") as jwt.SignOptions["expiresIn"];

    const token = jwt.sign(
      {
        role: "agent",
        roles: ["Admin", "Developer"],
        service: "kanban",
        serviceScopes: [...KANBAN_CORE_SERVICE_SCOPES],
      },
      secret,
      { subject: "kanban-service", audience, issuer, expiresIn },
    );
    return `Bearer ${token}`;
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
