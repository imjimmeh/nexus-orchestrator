import { SetMetadata } from "@nestjs/common";

export const KANBAN_REQUIRED_PERMISSION_KEY = "kanban_required_permission";

export const RequirePermission = (permission: string) =>
  SetMetadata(KANBAN_REQUIRED_PERMISSION_KEY, permission);
