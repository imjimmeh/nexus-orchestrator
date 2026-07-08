import type { Logger } from "@nestjs/common";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { KanbanWorkItemRunCostRepository } from "../database/repositories/kanban-work-item-run-cost.repository";
import type { OrchestrationRepairLaneService } from "../orchestration/control-plane/orchestration-repair-lane.service";
import type { OrchestrationService } from "../orchestration/orchestration.service";

/**
 * Dependencies for the terminal-run projection helpers extracted from
 * `CoreLifecycleStreamConsumerService`. Bundled into a struct so the
 * helpers can be unit-tested in isolation (the lifecycle consumer
 * passes its injected services; the unit test passes permissive fakes).
 */
export interface TerminalProjectionDeps {
  readonly logger: Logger;
  readonly orchestrationService: OrchestrationService;
  readonly workItems: KanbanWorkItemRepository;
  readonly workItemRunCosts: KanbanWorkItemRunCostRepository;
}

/**
 * Dependencies for the terminal-work-item-run helpers
 * (`reconcileTerminalWorkflowRun` / `recordTerminalRepairEvidence`).
 * Adds the repair-lane service to the base terminal-projection deps.
 */
export interface TerminalWorkItemRunDeps extends TerminalProjectionDeps {
  readonly repairLane: OrchestrationRepairLaneService;
}
