/**
 * Transport-only helpers used by {@link OrchestrationController} and
 * {@link OrchestrationActionRequestsController}.
 *
 * These helpers exist to keep the controllers strictly transport-facing:
 * they centralize the small pieces of validation, lookup, and projection
 * logic that the route handlers repeatedly need, without dragging the
 * orchestration services into HTTP-shaped concerns.
 *
 * Anything that depends on a NestJS-injected service takes that service
 * as its first parameter so the helpers remain plain free functions and
 * stay trivially unit-testable in isolation.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { WorkItemRecord } from "../work-item/work-item.types";
import type { OrchestrationService } from "./orchestration.service";
import type { WorkItemService } from "../work-item/work-item.service";
import type { ActionRequestStatusFilter } from "./orchestration.controller.types";

/**
 * Validate that `value` is a non-empty trimmed string and return it.
 *
 * Mirrors the behavior of the previous `OrchestrationController.requireString`
 * helper so existing error messages stay byte-identical for callers.
 */
export function requireString(
  value: string | undefined,
  field: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

/**
 * Trim a string value, returning `undefined` for empty/missing input.
 *
 * Mirrors the behavior of the previous `OrchestrationController.optionalString`
 * helper so existing call sites continue to pass `undefined` through.
 */
export function optionalString(
  value: string | undefined,
): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Fetch the orchestration record for `project_id`, returning `null` if
 * the orchestration has not been started yet.
 *
 * Treats `NotFoundException` as a non-error "no orchestration yet" signal
 * so callers can render a stable shape regardless of project state. The
 * return type is inferred (orchestration record | null) so callers see
 * the same projection as the underlying `OrchestrationService.get`.
 */
export async function getOrchestrationOrNull(
  orchestration: OrchestrationService,
  project_id: string,
) {
  try {
    return await orchestration.get(project_id);
  } catch (error) {
    if (error instanceof NotFoundException) {
      return null;
    }

    throw error;
  }
}

/**
 * Build a `Map<dependencyId, dependentIds[]>` from the supplied work
 * items. Used by {@link getProjectState} to expose which items each
 * dependency is blocking.
 */
export function getBlocksByItemId(
  items: WorkItemRecord[],
): Map<string, string[]> {
  const blocksByItemId = new Map<string, string[]>();
  for (const item of items) {
    for (const dependencyId of item.dependsOn ?? []) {
      const blocks = blocksByItemId.get(dependencyId) ?? [];
      blocks.push(item.id);
      blocksByItemId.set(dependencyId, blocks);
    }
  }
  return blocksByItemId;
}

/**
 * Project the project's work items into the shape returned by the
 * orchestration `GET /projects/:project_id/orchestration` endpoint.
 *
 * The projection is intentionally read-only and grouped by status so
 * downstream consumers (UI, agents) can render a stable work breakdown
 * regardless of underlying work-item changes.
 */
export async function getProjectState(
  workItems: WorkItemService,
  project_id: string,
): Promise<unknown> {
  const items = await workItems.listWorkItems(project_id);
  const blocksByItemId = getBlocksByItemId(items);
  const groupedByStatus: Record<string, unknown[]> = {};

  for (const item of items) {
    const statusItems = groupedByStatus[item.status] ?? [];
    statusItems.push({
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      dependsOn: item.dependsOn ?? [],
      blocks: blocksByItemId.get(item.id) ?? [],
      blockers: item.dependsOn ?? [],
    });
    groupedByStatus[item.status] = statusItems;
  }

  return {
    project_id,
    totalCount: items.length,
    activeCount: items.filter((item) => item.status !== "done").length,
    groupedByStatus,
  };
}

/**
 * Normalize an optional `?status=` query string into the canonical
 * {@link ActionRequestStatusFilter}. Unknown / missing values fall back
 * to `"all"` to preserve the previous controller behavior.
 */
export function toStatusFilter(
  status: string | undefined,
): ActionRequestStatusFilter {
  if (status === "pending" || status === "fulfilled" || status === "all") {
    return status;
  }

  return "all";
}