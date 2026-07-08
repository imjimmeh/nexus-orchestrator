import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanImportedRepositoryFindingEntity } from "../database/entities/kanban-imported-repository-finding.entity";
import type { KanbanImportedRepositoryFindingRepository } from "../database/repositories/kanban-imported-repository-finding.repository";
import { ImportedRepositoryFindingResolutionService } from "./imported-repository-finding-resolution.service";
import type { ReconciledWorkItemPublisher } from "./reconciled-work-item-publisher";

function buildFinding(
  overrides: Partial<KanbanImportedRepositoryFindingEntity> = {},
): KanbanImportedRepositoryFindingEntity {
  return {
    id: "finding-1",
    project_id: "project-1",
    source_id: "imported-repo:project-1:gap:api",
    source_hash: "hash-1",
    probe_artifact_path: "docs/project-context/probe-results/api.md",
    probe_scope_id: "api",
    project_scope_id: "project-1",
    title: "api",
    reason: "Missing API behavior",
    finding_kind: "gap",
    recommended_work_type: "gap",
    recommended_status: "todo",
    status: "pending_investigation",
    confidence_score: 0.7,
    evidence: {
      artifactPath: "docs/project-context/probe-results/api.md",
      evidenceRefs: [],
      sourcePaths: [],
      sourceId: "imported-repo:project-1:gap:api",
    },
    decision: null,
    work_item_id: null,
    metadata: { existing: true },
    observed_at: new Date("2026-05-19T12:00:00.000Z"),
    resolved_at: null,
    created_at: new Date("2026-05-19T12:00:00.000Z"),
    updated_at: new Date("2026-05-19T12:00:00.000Z"),
    ...overrides,
  };
}

describe("ImportedRepositoryFindingResolutionService", () => {
  let repository: {
    listByProject: ReturnType<typeof vi.fn>;
    findByIdForProject: ReturnType<typeof vi.fn>;
    resolveFinding: ReturnType<typeof vi.fn>;
  };
  let workItemPublisher: { publish: ReturnType<typeof vi.fn> };
  let service: ImportedRepositoryFindingResolutionService;

  beforeEach(() => {
    repository = {
      listByProject: vi.fn(),
      findByIdForProject: vi.fn(),
      resolveFinding: vi.fn(),
    };
    workItemPublisher = {
      publish: vi.fn(),
    };
    service = new ImportedRepositoryFindingResolutionService(
      repository as unknown as KanbanImportedRepositoryFindingRepository,
      workItemPublisher as unknown as ReconciledWorkItemPublisher,
    );
  });

  it("lists findings by project and status", async () => {
    repository.listByProject.mockResolvedValue([
      buildFinding({ id: "finding-a" }),
    ]);

    const result = await service.listFindings({
      projectId: "project-1",
      statuses: ["pending_investigation"],
      limit: 10,
    });

    expect(repository.listByProject).toHaveBeenCalledWith("project-1", {
      statuses: ["pending_investigation"],
      limit: 10,
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: "finding-a",
        projectId: "project-1",
        status: "pending_investigation",
      }),
    ]);
  });

  it("creates a work item from a finding and marks it converted", async () => {
    const finding = buildFinding();
    const resolvedFinding = buildFinding({
      status: "converted_to_work_item",
      work_item_id: "work-item-1",
    });
    repository.findByIdForProject.mockResolvedValue(finding);
    workItemPublisher.publish.mockResolvedValue({
      counts: { created: 1, updated: 0, unchanged: 0, skipped: 0, errors: 0 },
      outcomes: [
        {
          sourceId: finding.source_id,
          action: "created",
          workItemId: "work-item-1",
        },
      ],
    });
    repository.resolveFinding.mockResolvedValue(resolvedFinding);

    const result = await service.resolveFinding({
      projectId: "project-1",
      findingId: "finding-1",
      disposition: "create_work_item",
      rationale: "Ready to work",
      decidedBy: "tester",
    });

    expect(workItemPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        specs: [expect.objectContaining({ sourceId: finding.source_id })],
      }),
      "project-1",
    );
    expect(repository.resolveFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        findingId: "finding-1",
        status: "converted_to_work_item",
        workItemId: "work-item-1",
      }),
    );
    expect(result).toMatchObject({
      workItemId: "work-item-1",
      publishAction: "created",
      finding: { status: "converted_to_work_item", workItemId: "work-item-1" },
    });
  });

  it("records non-work dispositions without publishing work items", async () => {
    const finding = buildFinding();
    const resolvedFinding = buildFinding({ status: "resolved_existing" });
    repository.findByIdForProject.mockResolvedValue(finding);
    repository.resolveFinding.mockResolvedValue(resolvedFinding);

    const result = await service.resolveFinding({
      projectId: "project-1",
      findingId: "finding-1",
      disposition: "resolved_existing",
      rationale: "Already implemented",
      metadata: { note: "seen in code" },
    });

    expect(workItemPublisher.publish).not.toHaveBeenCalled();
    expect(repository.resolveFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "resolved_existing",
        decision: expect.objectContaining({
          disposition: "resolved_existing",
          autonomousDecision: true,
        }),
        metadata: expect.objectContaining({
          existing: true,
          note: "seen in code",
        }),
      }),
    );
    expect(result.finding.status).toBe("resolved_existing");
  });
});
