import { BadRequestException, Injectable } from "@nestjs/common";
import type { KanbanImportedRepositoryFindingEntity } from "../database/entities/kanban-imported-repository-finding.entity";
import { KanbanImportedRepositoryFindingRepository } from "../database/repositories/kanban-imported-repository-finding.repository";
import type {
  ImportedRepositoryBacklogReconciliationPlan,
  RepositoryWorkItemSpec,
} from "./imported-repository-backlog-reconciler.types";
import type {
  ImportedRepositoryFindingDecision,
  ImportedRepositoryFindingDisposition,
  ImportedRepositoryFindingStatus,
} from "./imported-repository-finding.types";
import type {
  ImportedRepositoryFindingDto,
  ListImportedRepositoryFindingsInput,
  ResolveImportedRepositoryFindingCommand,
  ResolveImportedRepositoryFindingResult,
} from "./imported-repository-finding-resolution.types";
import { ReconciledWorkItemPublisher } from "./reconciled-work-item-publisher";

@Injectable()
export class ImportedRepositoryFindingResolutionService {
  constructor(
    private readonly findings: KanbanImportedRepositoryFindingRepository,
    private readonly workItemPublisher: ReconciledWorkItemPublisher,
  ) {}

  async listFindings(
    input: ListImportedRepositoryFindingsInput,
  ): Promise<ImportedRepositoryFindingDto[]> {
    const entities = await this.findings.listByProject(input.projectId, {
      statuses: input.statuses,
      limit: input.limit,
    });
    return entities.map((e) => this.toDto(e));
  }

  async resolveFinding(
    input: ResolveImportedRepositoryFindingCommand,
  ): Promise<ResolveImportedRepositoryFindingResult> {
    const finding = await this.requireFinding(input.projectId, input.findingId);
    const decision = this.buildDecision(input);

    if (input.disposition === "create_work_item") {
      return this.createWorkItemFromFinding(input.projectId, finding, decision);
    }

    const resolved = await this.findings.resolveFinding({
      projectId: input.projectId,
      findingId: input.findingId,
      status: this.statusForDisposition(input.disposition),
      decision,
      metadata: { ...(finding.metadata ?? {}), ...(input.metadata ?? {}) },
    });

    return {
      finding: this.toDto(resolved),
    };
  }

  private async requireFinding(
    projectId: string,
    findingId: string,
  ): Promise<KanbanImportedRepositoryFindingEntity> {
    const finding = await this.findings.findByIdForProject(
      projectId,
      findingId,
    );
    if (!finding) {
      throw new BadRequestException(
        `Imported repository finding ${findingId} not found`,
      );
    }
    return finding;
  }

  private async createWorkItemFromFinding(
    projectId: string,
    finding: KanbanImportedRepositoryFindingEntity,
    decision: ImportedRepositoryFindingDecision,
  ): Promise<ResolveImportedRepositoryFindingResult> {
    const spec = this.toWorkItemSpec(finding, decision);
    const publishResult = await this.workItemPublisher.publish(
      this.toPlan(spec),
      projectId,
    );
    const outcome = publishResult.outcomes[0];
    if (!outcome || outcome.action === "error" || !outcome.workItemId) {
      throw new BadRequestException(
        outcome?.error ?? "Unable to create or update WorkItem from finding",
      );
    }

    const resolved = await this.findings.resolveFinding({
      projectId,
      findingId: finding.id,
      status: "converted_to_work_item",
      decision: { ...decision, generatedWorkItemId: outcome.workItemId },
      workItemId: outcome.workItemId,
      metadata: {
        ...(finding.metadata ?? {}),
        lastResolutionPublishAction: outcome.action,
      },
    });

    return {
      finding: this.toDto(resolved),
      workItemId: outcome.workItemId,
      publishAction: outcome.action,
    };
  }

  private statusForDisposition(
    disposition: ImportedRepositoryFindingDisposition,
  ): ImportedRepositoryFindingStatus {
    switch (disposition) {
      case "suppress":
        return "suppressed";
      case "needs_human":
        return "needs_human";
      case "resolved_existing":
        return "resolved_existing";
      default:
        throw new BadRequestException(`Unexpected disposition: ${disposition}`);
    }
  }

  private buildDecision(
    input: ResolveImportedRepositoryFindingCommand,
  ): ImportedRepositoryFindingDecision {
    return {
      disposition: input.disposition,
      rationale: input.rationale,
      decidedBy: input.decidedBy ?? "imported_repo_findings_resolution",
      decidedAt: new Date().toISOString(),
      autonomousDecision: input.decidedBy === undefined,
      metadata: input.metadata,
    };
  }

  private toWorkItemSpec(
    finding: KanbanImportedRepositoryFindingEntity,
    decision: ImportedRepositoryFindingDecision,
  ): RepositoryWorkItemSpec {
    return {
      sourceId: finding.source_id,
      status: finding.recommended_status,
      workType: finding.recommended_work_type,
      title: finding.title,
      reason: finding.reason,
      evidence: finding.evidence,
      metadata: {
        ...(finding.metadata ?? {}),
        sourceHash: finding.source_hash,
        importedRepoFindingId: finding.id,
        decision,
        generatedRecommendation: finding.recommended_status,
        lastGeneratedStatus: finding.recommended_status,
        lastGeneratedWorkType: finding.recommended_work_type,
      },
    };
  }

  private toPlan(
    spec: RepositoryWorkItemSpec,
  ): ImportedRepositoryBacklogReconciliationPlan {
    return {
      specs: [spec],
      findings: [spec],
      counts: {
        total: 1,
        done: spec.status === "done" ? 1 : 0,
        todo: spec.status === "todo" ? 1 : 0,
        blocked: spec.status === "blocked" ? 1 : 0,
      },
      summary: `Resolved imported finding ${spec.sourceId}`,
      diagnostics: { artifactCount: 1, mappedSpecs: 1, mappedFindings: 1 },
      cycleDecision: {
        decision: spec.status === "todo" ? "repeat" : "complete",
        reason: "Finding resolved",
        readyForCycle: true,
      },
      openQuestions: [],
    };
  }

  private toDto(
    finding: KanbanImportedRepositoryFindingEntity,
  ): ImportedRepositoryFindingDto {
    return {
      id: finding.id,
      projectId: finding.project_id,
      sourceId: finding.source_id,
      sourceHash: finding.source_hash,
      title: finding.title,
      reason: finding.reason,
      findingKind: finding.finding_kind,
      recommendedWorkType: finding.recommended_work_type,
      recommendedStatus: finding.recommended_status,
      status: finding.status,
      evidence: finding.evidence,
      decision: finding.decision,
      workItemId: finding.work_item_id,
    };
  }
}
