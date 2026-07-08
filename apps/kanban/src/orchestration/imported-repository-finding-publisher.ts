import { Injectable, Logger } from "@nestjs/common";
import { KanbanImportedRepositoryFindingRepository } from "../database/repositories/kanban-imported-repository-finding.repository";
import type {
  ImportedRepositoryFindingStatus,
  UpsertImportedRepositoryFindingInput,
} from "./imported-repository-finding.types";
import type { RepositoryWorkItemSpec } from "./imported-repository-backlog-reconciler.types";
import type {
  ImportedRepositoryFindingPublishOutcome,
  ImportedRepositoryFindingPublishResult,
} from "./imported-repository-finding-publisher.types";

@Injectable()
export class ImportedRepositoryFindingPublisher {
  private readonly logger = new Logger(ImportedRepositoryFindingPublisher.name);

  constructor(
    private readonly findingRepository: KanbanImportedRepositoryFindingRepository,
  ) {}

  async publish(
    specs: RepositoryWorkItemSpec[],
    projectId: string,
    probeArtifactPath: string,
  ): Promise<ImportedRepositoryFindingPublishResult> {
    const counts = { created: 0, updated: 0, unchanged: 0, errors: 0 };
    const outcomes: ImportedRepositoryFindingPublishOutcome[] = [];

    for (const spec of specs) {
      const outcome = await this.publishSpec(
        spec,
        projectId,
        probeArtifactPath,
      );
      outcomes.push(outcome);

      if (outcome.action === "created") counts.created++;
      else if (outcome.action === "updated") counts.updated++;
      else if (outcome.action === "unchanged") counts.unchanged++;
      else counts.errors++;
    }

    return { counts, outcomes };
  }

  private async publishSpec(
    spec: RepositoryWorkItemSpec,
    projectId: string,
    probeArtifactPath: string,
  ): Promise<ImportedRepositoryFindingPublishOutcome> {
    try {
      const existing = await this.findingRepository.findBySourceId(
        projectId,
        spec.sourceId,
      );

      const initialStatus = this.initialStatus(spec);
      const input: UpsertImportedRepositoryFindingInput = {
        projectId,
        sourceId: spec.sourceId,
        sourceHash: spec.metadata.sourceHash,
        probeArtifactPath,
        probeScopeId: spec.evidence.probeScopeId,
        projectScopeId: spec.evidence.projectScopeId,
        title: spec.title,
        reason: spec.reason,
        findingKind: spec.workType,
        recommendedWorkType: spec.workType,
        recommendedStatus: spec.status,
        status: initialStatus,
        confidenceScore: spec.evidence.confidenceScore,
        evidence: {
          ...spec.evidence,
          sourceId: spec.sourceId,
        },
        metadata: spec.metadata,
      };

      if (!existing) {
        const created = await this.findingRepository.upsertFinding(input);
        return {
          sourceId: spec.sourceId,
          action: "created",
          findingId: created.id,
        };
      }

      // Skip if source hash unchanged and in terminal state
      if (
        existing.source_hash === input.sourceHash &&
        this.isTerminalStatus(existing.status)
      ) {
        return {
          sourceId: spec.sourceId,
          action: "unchanged",
          findingId: existing.id,
        };
      }

      // Resolve existing_capability with high confidence automatically
      if (
        spec.workType === "existing_capability" &&
        spec.status === "done" &&
        (spec.evidence.confidenceScore ?? 0) >= 0.8
      ) {
        const updated = await this.findingRepository.resolveFinding({
          projectId,
          findingId: existing.id,
          status: "resolved_existing",
          decision: {
            disposition: "resolved_existing",
            rationale: "High-confidence existing capability",
            decidedBy: "system",
            decidedAt: new Date().toISOString(),
            autonomousDecision: true,
          },
        });
        return {
          sourceId: spec.sourceId,
          action: "updated",
          findingId: updated.id,
        };
      }

      // Update the finding with latest data
      const updated = await this.findingRepository.upsertFinding({
        ...input,
        status: this.preserveOrAdvanceStatus(existing.status, initialStatus),
      });
      return {
        sourceId: spec.sourceId,
        action: "updated",
        findingId: updated.id,
      };
    } catch (error) {
      this.logger.error(
        `Error publishing finding ${spec.sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        sourceId: spec.sourceId,
        action: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private initialStatus(
    spec: RepositoryWorkItemSpec,
  ): ImportedRepositoryFindingStatus {
    if (spec.workType === "existing_capability" && spec.status === "done") {
      return "resolved_existing";
    }
    return "pending_investigation";
  }

  private isTerminalStatus(status: ImportedRepositoryFindingStatus): boolean {
    return (
      status === "converted_to_work_item" ||
      status === "resolved_existing" ||
      status === "suppressed"
    );
  }

  private preserveOrAdvanceStatus(
    current: ImportedRepositoryFindingStatus,
    fresh: ImportedRepositoryFindingStatus,
  ): ImportedRepositoryFindingStatus {
    if (this.isTerminalStatus(current)) return current;
    return fresh;
  }
}
