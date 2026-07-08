import type { Logger } from "@nestjs/common";
import type { KanbanRetrospectiveService } from "../retrospectives/kanban-retrospective.service";
import type { OrchestrationPersistenceRecord } from "./orchestration-internal.types";

/**
 * Helper that fires the completion retrospective for a project after a
 * `complete` cycle decision has been recorded. The logger is injected
 * as a parameter (no NestJS logger is imported directly) so the helper
 * remains free of NestJS runtime dependencies.
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep that
 * service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 */

export async function runCompletionRetrospective(args: {
  readonly projectId: string;
  readonly existing: OrchestrationPersistenceRecord;
  readonly input: {
    readonly triggerRevisionMarker: string;
    readonly decisionIdempotencyKey?: string;
  };
  readonly retrospectives: KanbanRetrospectiveService;
  readonly logger: Logger;
}): Promise<void> {
  const { projectId, existing, input, retrospectives, logger } = args;

  try {
    await retrospectives.runForCompletion({
      project_id: projectId,
      orchestration_id: existing.project_id,
      trigger_revision_marker: input.triggerRevisionMarker,
      cycle_decision: "complete",
      trigger_details: {
        ...(input.decisionIdempotencyKey
          ? { decision_idempotency_key: input.decisionIdempotencyKey }
          : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Completion retrospective failed for project ${projectId}: ${message}`,
    );
  }
}