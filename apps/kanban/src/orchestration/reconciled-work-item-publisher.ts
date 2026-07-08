import { Injectable } from "@nestjs/common";
import type {
  CreateWorkItemInput,
  WorkItemRecord,
} from "@nexus/kanban-contracts";
import { WorkItemService } from "../work-item/work-item.service";
import type {
  ImportedRepositoryBacklogReconciliationPlan,
  RepositoryWorkItemSpec,
} from "./imported-repository-backlog-reconciler";
import type {
  ReconciliationMetadata,
  ReconciledPublishResult,
  ItemOutcome,
} from "./reconciled-work-item-publisher.types";

@Injectable()
export class ReconciledWorkItemPublisher {
  constructor(private readonly workItemService: WorkItemService) {}

  async publish(
    plan: ImportedRepositoryBacklogReconciliationPlan,
    projectId: string,
  ): Promise<ReconciledPublishResult> {
    const existing = await this.workItemService.listWorkItems(projectId);
    const index = this.indexBySourceId(existing);

    const counts = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
    };
    const outcomes: ItemOutcome[] = [];

    for (const spec of plan.specs) {
      const outcome = await this.processSpec(spec, projectId, index);
      outcomes.push(outcome);

      if (outcome.action === "created") counts.created++;
      else if (outcome.action === "updated") counts.updated++;
      else if (outcome.action === "unchanged") counts.unchanged++;
      else if (outcome.action === "skipped") counts.skipped++;
      else counts.errors++;
    }

    return { counts, outcomes };
  }

  private indexBySourceId(
    items: WorkItemRecord[],
  ): Map<string, WorkItemRecord> {
    const map = new Map<string, WorkItemRecord>();
    for (const item of items) {
      const meta = item.metadata as Record<string, unknown> | null;
      if (typeof meta?.sourceId === "string") {
        map.set(meta.sourceId, item);
      }
    }
    return map;
  }

  private resolveExisting(
    sourceId: string,
    index: Map<string, WorkItemRecord>,
  ): { item: WorkItemRecord; aliased: boolean } | undefined {
    const direct = index.get(sourceId);
    if (direct) return { item: direct, aliased: false };

    const humanDecisionAlias = sourceId.replace(/:gap:/, ":human_decision:");
    if (humanDecisionAlias !== sourceId) {
      const aliased = index.get(humanDecisionAlias);
      if (aliased) return { item: aliased, aliased: true };
    }

    const gapAlias = sourceId.replace(/:human_decision:/, ":gap:");
    if (gapAlias !== sourceId) {
      const aliased = index.get(gapAlias);
      if (aliased) return { item: aliased, aliased: true };
    }

    return undefined;
  }

  private fieldMatches(
    existingMeta: Record<string, unknown>,
    specMeta: Record<string, unknown>,
    key: string,
  ): boolean {
    const specValue = specMeta[key];
    if (specValue === undefined) return true;
    if (specValue === null) {
      return existingMeta[key] === undefined || existingMeta[key] === null;
    }
    return existingMeta[key] === specValue;
  }

  private generatedMetaMatches(
    existingMeta: Record<string, unknown> | null,
    spec: RepositoryWorkItemSpec,
  ): boolean {
    if (!existingMeta) return true;
    const specMeta = this.buildReconciliationMetadata(spec, spec.sourceId);
    if (!this.fieldMatches(existingMeta, specMeta, "workType")) return false;
    if (!this.fieldMatches(existingMeta, specMeta, "lastGeneratedStatus"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "lastGeneratedWorkType"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "generatedRecommendation"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "originalWorkType"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "policy")) return false;
    if (!this.fieldMatches(existingMeta, specMeta, "autonomousDecision"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "feedbackNeeded"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "decisionPrompt"))
      return false;
    if (!this.fieldMatches(existingMeta, specMeta, "resolutionRationale"))
      return false;
    return true;
  }

  private async processSpec(
    spec: RepositoryWorkItemSpec,
    projectId: string,
    index: Map<string, WorkItemRecord>,
  ): Promise<ItemOutcome> {
    try {
      const resolved = this.resolveExisting(spec.sourceId, index);

      if (!resolved) {
        return await this.createSpec(spec, projectId, index);
      }

      const { item: existing, aliased } = resolved;
      const existingMeta = existing.metadata as Record<string, unknown> | null;
      if (this.isUnchangedSpec(existing, existingMeta, spec)) {
        return {
          sourceId: spec.sourceId,
          action: "unchanged",
          workItemId: existing.id,
        };
      }

      if (this.isUserOverrideUnchanged(existing, existingMeta, spec)) {
        return {
          sourceId: spec.sourceId,
          action: "unchanged",
          workItemId: existing.id,
        };
      }

      return await this.updateSpec(
        spec,
        projectId,
        existing.id,
        existing.status,
        existingMeta,
        aliased,
        index,
      );
    } catch (error) {
      return {
        sourceId: spec.sourceId,
        action: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private isUnchangedSpec(
    existing: WorkItemRecord,
    existingMeta: Record<string, unknown> | null,
    spec: RepositoryWorkItemSpec,
  ): boolean {
    const hashMatches = existingMeta?.sourceHash === spec.metadata.sourceHash;
    const statusMatches = existing.status === spec.status;
    const metaMatches = this.generatedMetaMatches(existingMeta, spec);
    return hashMatches && statusMatches && metaMatches;
  }

  private isUserOverrideUnchanged(
    existing: WorkItemRecord,
    existingMeta: Record<string, unknown> | null,
    spec: RepositoryWorkItemSpec,
  ): boolean {
    const hashMatches = existingMeta?.sourceHash === spec.metadata.sourceHash;
    const metaMatches = this.generatedMetaMatches(existingMeta, spec);
    return (
      existingMeta?.userStatusOverride === true &&
      existingMeta?.generatedRecommendation === spec.status &&
      existingMeta?.currentDisposition === existing.status &&
      hashMatches &&
      metaMatches
    );
  }

  private buildReconciliationMetadata(
    spec: RepositoryWorkItemSpec,
    stableSourceId: string,
  ): ReconciliationMetadata {
    const specMetadata = spec.metadata as Record<string, unknown>;
    const clearsDecisionPrompt =
      specMetadata.autonomousDecision === true ||
      specMetadata.feedbackNeeded === false;

    return {
      ...specMetadata,
      importedRepoReconciliation: true,
      sourceId: stableSourceId,
      sourceHash: spec.metadata.sourceHash,
      workType: spec.workType,
      evidence: spec.evidence,
      reason: spec.reason,
      lastGeneratedStatus: spec.status,
      lastGeneratedWorkType: spec.workType,
      generatedRecommendation: spec.status,
      ...(clearsDecisionPrompt ? { decisionPrompt: null } : {}),
    };
  }

  private stableSourceId(
    spec: RepositoryWorkItemSpec,
    aliased: boolean,
    existingMetadata: Record<string, unknown> | null,
  ): string {
    if (
      aliased &&
      existingMetadata?.sourceId &&
      typeof existingMetadata.sourceId === "string"
    ) {
      return existingMetadata.sourceId;
    }
    return spec.sourceId;
  }

  private async createSpec(
    spec: RepositoryWorkItemSpec,
    projectId: string,
    index: Map<string, WorkItemRecord>,
  ): Promise<ItemOutcome> {
    const metadata = this.buildReconciliationMetadata(spec, spec.sourceId);

    const input: CreateWorkItemInput = {
      title: spec.title,
      description: spec.reason,
      status: spec.status,
      metadata,
    };

    const created = await this.workItemService.createWorkItem(projectId, input);
    index.set(spec.sourceId, { ...created, status: spec.status, metadata });
    return {
      sourceId: spec.sourceId,
      action: "created",
      workItemId: created.id,
    };
  }

  private async updateSpec(
    spec: RepositoryWorkItemSpec,
    projectId: string,
    workItemId: string,
    currentStatus: string,
    existingMetadata: Record<string, unknown> | null,
    aliased: boolean,
    index: Map<string, WorkItemRecord>,
  ): Promise<ItemOutcome> {
    const lastGeneratedStatus = existingMetadata?.lastGeneratedStatus as
      | string
      | undefined;
    const userHasOverride = existingMetadata?.userStatusOverride === true;
    const reconciliationOwnsStatus =
      !userHasOverride &&
      (lastGeneratedStatus === undefined ||
        currentStatus === lastGeneratedStatus);

    if (currentStatus !== spec.status) {
      if (reconciliationOwnsStatus) {
        await this.workItemService.updateStatus(
          projectId,
          workItemId,
          spec.status,
        );
      }
    }

    const stableId = this.stableSourceId(spec, aliased, existingMetadata);
    const reconciliationMeta = this.buildReconciliationMetadata(spec, stableId);

    let metadata: Record<string, unknown>;
    if (reconciliationOwnsStatus) {
      metadata = { ...(existingMetadata ?? {}), ...reconciliationMeta };
    } else {
      metadata = {
        ...(existingMetadata ?? {}),
        ...reconciliationMeta,
        userStatusOverride: true,
        overridePreservedAt: new Date().toISOString(),
        generatedRecommendation: spec.status,
        currentDisposition: currentStatus,
      };
    }

    const updated = await this.workItemService.updateWorkItem(
      projectId,
      workItemId,
      {
        title: spec.title,
        description: spec.reason,
        metadata,
      },
    );

    const indexStatus: WorkItemRecord["status"] = reconciliationOwnsStatus
      ? spec.status
      : (currentStatus as WorkItemRecord["status"]);
    index.set(stableId, { ...updated, status: indexStatus, metadata });
    return { sourceId: stableId, action: "updated", workItemId };
  }
}
