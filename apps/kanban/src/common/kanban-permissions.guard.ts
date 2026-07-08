import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { KANBAN_REQUIRED_PERMISSION_KEY } from "./require-permission.decorator";

interface PermissionsResponse {
  permissions: string[];
}

@Injectable()
export class KanbanPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  private get coreBaseUrl(): string {
    return process.env.KANBAN_CORE_BASE_URL ?? "http://localhost:3010/api";
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(
      KANBAN_REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      params: Record<string, string>;
    }>();

    const rawAuth = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    if (!rawAuth || !/^Bearer\s+\S+$/i.test(rawAuth.trim())) return false;

    const projectId = req.params.project_id;
    if (!projectId) return false;

    const url = `${this.coreBaseUrl.replace(/\/$/, "")}/me/permissions?scopeNodeId=${encodeURIComponent(projectId)}`;

    let perms: PermissionsResponse;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: rawAuth,
        },
      });
      if (!response.ok) return false;
      perms = (await response.json()) as PermissionsResponse;
    } catch {
      return false;
    }

    const [resource] = required.split(":");
    return (
      perms.permissions.includes(required) ||
      perms.permissions.includes(`${resource}:manage`)
    );
  }
}
