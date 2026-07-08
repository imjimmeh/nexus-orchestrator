import type { Logger } from "@nestjs/common";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { WorkItemRunLeaseService } from "../work-item/work-item-run-lease";

/**
 * Dependencies for {@link linkWorkItemRunFromLifecycleEvent}. Bundled
 * into a struct so the helper can be unit-tested in isolation (the
 * lifecycle consumer can pass real services; the unit test passes
 * permissive fakes).
 */
export interface LinkWorkItemRunFromLifecycleEventDeps {
  readonly logger: Logger;
  readonly workItems: KanbanWorkItemRepository;
  readonly workItemRunLeaseService: WorkItemRunLeaseService;
}