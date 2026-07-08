import type {
  CreateWorkItemInput,
  WorkItemRecord,
} from "@nexus/kanban-contracts";
import type { RepositoryWorkItemSpec } from "./imported-repository-backlog-reconciler";

export interface ReconciledWorkItemPublisherPort {
  listWorkItems(projectId: string): Promise<WorkItemRecord[]>;
  createWorkItem(
    projectId: string,
    input: CreateWorkItemInput,
  ): Promise<WorkItemRecord>;
  updateWorkItem(
    projectId: string,
    workItemId: string,
    data: unknown,
  ): Promise<WorkItemRecord>;
  updateStatus(
    projectId: string,
    workItemId: string,
    status: string,
  ): Promise<WorkItemRecord>;
}

export interface ReconciliationMetadata {
  importedRepoReconciliation: true;
  sourceId: string;
  sourceHash: string;
  workType: string;
  evidence: RepositoryWorkItemSpec["evidence"];
  reason: string;
  [key: string]: unknown;
}

export type ItemOutcome = {
  sourceId: string;
  action: "created" | "updated" | "unchanged" | "skipped" | "error";
  workItemId?: string;
  error?: string;
};

export interface ReconciledPublishResult {
  counts: {
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
    errors: number;
  };
  outcomes: ItemOutcome[];
}
