import type { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { KanbanLifecycleEventPublisher } from "./kanban-lifecycle-event-publisher";
import type { WorkItemRealtimeGateway } from "./work-item-realtime.gateway";
import type { WorkItemRealtimePublisher } from "./work-item-realtime.publisher";
import type { CoreWorkflowRequester } from "./work-item.service.types";
import type { WorkItemStatus } from "./work-item.types";

export interface TransitionStatusDeps {
  workItems: KanbanWorkItemRepository;
  projects: KanbanProjectRepository;
  coreClient: CoreWorkflowRequester;
  lifecycleEventPublisher: KanbanLifecycleEventPublisher;
  realtimeGateway: WorkItemRealtimeGateway;
  realtimePublisher: WorkItemRealtimePublisher;
}

export interface TransitionStatusParams {
  project_id: string;
  workItemId: string;
  status: WorkItemStatus;
  actor: string;
}
