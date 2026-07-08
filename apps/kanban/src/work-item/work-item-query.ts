import { BadRequestException } from "@nestjs/common";
import { WorkItemQuerySchema } from "@nexus/kanban-contracts";
import type { WorkItemQueryParams } from "../database/repositories/kanban-work-item.repository.types";

export function parseWorkItemQuery(
  raw: Record<string, unknown>,
): WorkItemQueryParams {
  const result = WorkItemQuerySchema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestException(
      `Invalid work item query: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  // projectId is intentionally dropped here; controllers set it explicitly
  // (path param for the project-scoped endpoint, query filter for the global one).
  const { projectId, ...rest } = result.data;
  void projectId;
  return rest;
}
