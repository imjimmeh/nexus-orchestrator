// packages/e2e-tests/src/driver/kanban-client.ts
import { ApiClient } from "./api-client.js";
import type {
  Initiative,
  KanbanProject,
  KanbanWorkItem,
  TimelineEntry,
} from "./kanban-client.types.js";

export type { Initiative, KanbanProject, KanbanWorkItem, TimelineEntry };

// All Kanban API responses are wrapped in { success: boolean; data: T }
interface KanbanResponse<T> {
  success: boolean;
  data: T;
}

// The work-item list endpoints return a paginated envelope.
interface PaginatedWorkItems {
  items: KanbanWorkItem[];
  total: number;
  limit: number;
  offset: number;
}

export class KanbanClient {
  private readonly client: ApiClient;

  constructor(baseUrl: string, token: string) {
    this.client = new ApiClient({ baseUrl: `${baseUrl}/api`, token });
  }

  async createProject(name: string): Promise<KanbanProject> {
    const response = await this.client.post<KanbanResponse<KanbanProject>>(
      "/projects",
      { name, description: `e2e-${name}` },
    );
    return response.data;
  }

  async createWorkItem(
    projectId: string,
    title: string,
  ): Promise<KanbanWorkItem> {
    const response = await this.client.post<KanbanResponse<KanbanWorkItem>>(
      `/projects/${projectId}/work-items`,
      {
        title,
        description: `e2e test work item: ${title}`,
      },
    );
    return response.data;
  }

  async getWorkItem(
    projectId: string,
    workItemId: string,
  ): Promise<KanbanWorkItem> {
    // The Kanban API has no GET /projects/:id/work-items/:workItemId endpoint;
    // fetch the project's work-item list and find by ID.
    const response = await this.client.get<KanbanResponse<PaginatedWorkItems>>(
      `/projects/${projectId}/work-items?limit=200`,
    );
    const item = response.data.items.find((w) => w.id === workItemId);
    if (!item) {
      throw new Error(
        `Work item ${workItemId} not found in project ${projectId}`,
      );
    }
    return item;
  }

  async transitionWorkItem(
    projectId: string,
    workItemId: string,
    status: string,
  ): Promise<KanbanWorkItem> {
    const response = await this.client.patch<KanbanResponse<KanbanWorkItem>>(
      `/projects/${projectId}/work-items/${workItemId}/status`,
      { status },
    );
    return response.data;
  }

  async listWorkItems(projectId: string): Promise<KanbanWorkItem[]> {
    const response = await this.client.get<KanbanResponse<PaginatedWorkItems>>(
      `/projects/${projectId}/work-items?limit=200`,
    );
    return response.data.items;
  }

  async listInitiatives(projectId: string): Promise<Initiative[]> {
    const response = await this.client.get<KanbanResponse<Initiative[]>>(
      `/projects/${projectId}/initiatives`,
    );
    return response.data;
  }

  async getOrchestrationTimeline(projectId: string): Promise<TimelineEntry[]> {
    const response = await this.client.get<KanbanResponse<TimelineEntry[]>>(
      `/projects/${projectId}/orchestration/timeline`,
    );
    return response.data;
  }
}
