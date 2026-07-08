import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconcileImportedRepositoryBacklogSchema } from "../shared/schemas";
import { ReconcileImportedRepositoryBacklogTool } from "./reconcile-imported-repository-backlog.tool";
import { ReconciledWorkItemPublisher } from "../../../orchestration/reconciled-work-item-publisher";
import { ImportedRepositoryFindingPublisher } from "../../../orchestration/imported-repository-finding-publisher";

interface PlanToolResult extends Record<string, unknown> {
  status: "plan";
  dry_run: boolean;
  plan: {
    counts: { total: number };
    cycleDecision: unknown;
  };
}

interface PublishedToolResult extends Record<string, unknown> {
  status: "published";
  dry_run: boolean;
  plan: {
    counts: { total: number };
    cycleDecision: unknown;
  };
  publish: {
    counts: Record<string, number>;
    outcomes?: Array<Record<string, unknown>>;
  };
}

interface BlockedToolResult extends Record<string, unknown> {
  status: "blocked";
  diagnostics?: Array<Record<string, unknown>>;
}

interface MockPublisher {
  publish: ReturnType<typeof vi.fn>;
}

interface MockFindingPublisher {
  publish: ReturnType<typeof vi.fn>;
}

describe("ReconcileImportedRepositoryBacklogTool", () => {
  const temporaryWorkspaces: string[] = [];
  const context = {} as InternalToolExecutionContext;

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      temporaryWorkspaces.map((ws) => rm(ws, { recursive: true, force: true })),
    );
    temporaryWorkspaces.length = 0;
  });

  it("has tool name kanban.reconcile_imported_repository_backlog from both getName and getDefinition", () => {
    const { tool } = createTool();
    expect(tool.getName()).toBe("kanban.reconcile_imported_repository_backlog");
    expect(tool.getDefinition().name).toBe(
      "kanban.reconcile_imported_repository_backlog",
    );
  });

  it("returns a reconciliation plan without publishing when dry_run is true", async () => {
    const { workspaceRoot, probeDir } =
      await createWorkspaceWithValidProbeArtifact();
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPlanResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
        dry_run: true,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: "plan",
      project_id: "imported-repo",
      dry_run: true,
    });
    expect(result.plan).toBeDefined();
    expect(result.plan.counts).toBeDefined();
    expect(result.plan.cycleDecision).toBeDefined();
    expect(result.dry_run).toBe(true);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("publish");
  });

  it("invokes publisher and returns publish summary in publish mode", async () => {
    const { workspaceRoot, probeDir } =
      await createWorkspaceWithValidProbeArtifact();
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPublishedResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: "published",
      project_id: "imported-repo",
      dry_run: false,
    });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ specs: expect.any(Array) }),
      "imported-repo",
    );
    expect(result.publish).toMatchObject({
      counts: { created: 1, updated: 0, unchanged: 0, skipped: 0, errors: 0 },
    });
    expect(result.plan).toBeDefined();
    expect(result.cycleDecision).toBeDefined();
    expect(result.readyForCycle).toBeDefined();
  });

  it("returns blocked status with diagnostics when a successful probe artifact is invalid", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    await writeFile(
      path.join(probeDir, "invalid-probe.md"),
      [
        "---",
        "project_scope_id: project-1",
        "probe_scope_id: api",
        "outcome: success",
        "inferred_status: implemented",
        "confidence_score: 0.9",
        "evidence_refs:",
        "  - apps/api/src/main.ts",
        "---",
        "# Probe Result: API",
        "",
      ].join("\n"),
      "utf-8",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectBlockedResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: "invalid_probe_results",
      project_id: "imported-repo",
    });
    expect(result.diagnostics).toBeDefined();
    const diagnostics = result.diagnostics ?? [];
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]).toMatchObject({
      file_name: "invalid-probe.md",
      missing_fields: expect.arrayContaining(["narrative_summary"]),
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("returns blocked diagnostics for quoted successful probe artifacts missing required fields", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    await writeFile(
      path.join(probeDir, "quoted-invalid-probe.md"),
      [
        "---",
        "project_scope_id: project-1",
        "probe_scope_id: api",
        'outcome: "success"',
        "inferred_status: implemented",
        "confidence_score: 0.9",
        "---",
        "# Probe Result: API",
        "",
      ].join("\n"),
      "utf-8",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectBlockedResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: "invalid_probe_results",
      project_id: "imported-repo",
    });
    expect(result.diagnostics?.[0]).toMatchObject({
      file_name: "quoted-invalid-probe.md",
      missing_fields: expect.arrayContaining(["narrative_summary"]),
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("uses the default probe directory when probe_artifact_directory is not provided", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const defaultProbeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(defaultProbeDir, { recursive: true });
    await writeValidProbeArtifact(defaultProbeDir, "default-probe.md", {
      probeScopeId: "default-scope",
      inferredStatus: "implemented",
      confidenceScore: 0.85,
    });
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPlanResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        dry_run: true,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: "plan",
      project_id: "imported-repo",
      dry_run: true,
    });
    expect(result.plan.counts.total).toBeGreaterThanOrEqual(1);
  });

  it("returns blocked when no probe markdown files exist", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    const publisher = createMockPublisher();
    const findingPublisher = createMockFindingPublisher();
    const { tool } = createTool({ publisher, findingPublisher });

    const result = expectBlockedResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
        orchestration_mode: "autonomous",
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: "missing_probe_results",
      project_id: "imported-repo",
      readyForCycle: false,
    });
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(findingPublisher.publish).not.toHaveBeenCalled();
  });

  it("records findings instead of publishing work items in autonomous mode", async () => {
    const { workspaceRoot, probeDir } =
      await createWorkspaceWithValidProbeArtifact();
    const publisher = createMockPublisher();
    const findingPublisher = createMockFindingPublisher();
    const { tool } = createTool({ publisher, findingPublisher });

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      probe_artifact_directory: probeDir,
      orchestration_mode: "autonomous",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "findings_recorded",
      project_id: "imported-repo",
      dry_run: false,
      readyForCycle: false,
    });
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(findingPublisher.publish).toHaveBeenCalledTimes(1);
    expect(findingPublisher.publish).toHaveBeenCalledWith(
      expect.any(Array),
      "imported-repo",
      probeDir,
    );
  });

  it("reconciles non-success probe artifacts with health findings instead of skipping them", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    await writeFile(
      path.join(probeDir, "health-finding-probe.md"),
      [
        "---",
        "project_scope_id: project-1",
        "probe_scope_id: api-health",
        "outcome: failed",
        "inferred_status: partial",
        "confidence_score: 0.5",
        "evidence_refs:",
        "  - apps/api/src/main.ts",
        "---",
        "# Probe Result",
        "",
        "## Health Findings",
        "Missing imported repository smoke tests.",
        "",
      ].join("\n"),
      "utf-8",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPlanResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
        dry_run: true,
      }),
    );

    expect(result.plan.counts).toMatchObject({ total: 1, todo: 1 });
    expect(result.plan.cycleDecision).toMatchObject({ decision: "repeat" });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("parses the input schema with optional fields", () => {
    const parsed = ReconcileImportedRepositoryBacklogSchema.parse({
      project_id: "proj-1",
      workspace_root: "/tmp/workspace",
      goals: ["goal-a"],
      probe_artifact_directory: "custom/probes",
      dry_run: true,
    });
    expect(parsed).toMatchObject({
      project_id: "proj-1",
      workspace_root: "/tmp/workspace",
      goals: ["goal-a"],
      probe_artifact_directory: "custom/probes",
      dry_run: true,
    });

    const minimal = ReconcileImportedRepositoryBacklogSchema.parse({
      project_id: "proj-2",
      workspace_root: "/tmp/ws",
    });
    expect(minimal).toMatchObject({
      project_id: "proj-2",
      workspace_root: "/tmp/ws",
    });
  });

  it("passes orchestration_mode to the reconciler and yields non-blocking plan", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    await writeFile(
      path.join(probeDir, "open-question.md"),
      [
        "---",
        "project_scope_id: project-1",
        "probe_scope_id: migration",
        "outcome: partial",
        "inferred_status: unknown",
        "confidence_score: 0.4",
        "---",
        "# Probe Result",
        "",
        "## Open Questions",
        "Should legacy data be migrated in-place or via ETL?",
        "",
      ].join("\n"),
      "utf-8",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPlanResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
        dry_run: true,
        orchestration_mode: "autonomous",
      }),
    );

    expect(result.plan).toBeDefined();
    expect(result.plan.counts).toMatchObject({ blocked: 0, todo: 1 });
    expect(result.cycleDecision).toMatchObject({ decision: "repeat" });
  });

  it("passes human_decision_policy override to the reconciler for non-blocking plan", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    await writeFile(
      path.join(probeDir, "decision-needed.md"),
      [
        "---",
        "project_scope_id: project-1",
        "probe_scope_id: review",
        "outcome: partial",
        "inferred_status: unknown",
        "confidence_score: 0.3",
        "---",
        "# Probe Result",
        "",
        "## Health Findings",
        "This requires product decision on data retention policy.",
        "",
      ].join("\n"),
      "utf-8",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPlanResult(
      await tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: probeDir,
        dry_run: true,
        human_decision_policy: "decide_without_approval",
      }),
    );

    expect(result.plan).toBeDefined();
    expect(result.plan.counts).toMatchObject({ blocked: 0, todo: 1 });
    expect(result.cycleDecision).toMatchObject({ decision: "repeat" });
  });

  it("rejects invalid orchestration_mode values", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        orchestration_mode: "invalid_mode" as
          | "autonomous"
          | "supervised"
          | "notifications_only",
        dry_run: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid human_decision_policy values", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        human_decision_policy: "invalid_policy" as
          | "decide_without_approval"
          | "ask_when_uncertain"
          | "always_supervise",
        dry_run: true,
      }),
    ).rejects.toThrow();
  });

  it("resolves ReconciledWorkItemPublisher through Nest DI constructor injection", async () => {
    const mockPublish = vi.fn().mockResolvedValue({
      counts: { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 },
      outcomes: [],
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconcileImportedRepositoryBacklogTool,
        {
          provide: ReconciledWorkItemPublisher,
          useFactory: () => ({ publish: mockPublish }),
        },
        {
          provide: ImportedRepositoryFindingPublisher,
          useFactory: createMockFindingPublisher,
        },
      ],
    }).compile();

    const tool = moduleRef.get(ReconcileImportedRepositoryBacklogTool);
    expect(tool).toBeInstanceOf(ReconcileImportedRepositoryBacklogTool);
    expect(tool.getName()).toBe("kanban.reconcile_imported_repository_backlog");
  });

  it("derives project_id from context.scopeId when project_id is omitted", async () => {
    const { workspaceRoot, probeDir } =
      await createWorkspaceWithValidProbeArtifact();
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    const result = expectPlanResult(
      await tool.execute(
        { scopeId: "project-from-context" },
        {
          workspace_root: workspaceRoot,
          probe_artifact_directory: probeDir,
          dry_run: true,
        },
      ),
    );

    expect(result.project_id).toBe("project-from-context");
  });

  it("rejects probe_artifact_directory with traversal outside workspace_root", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: "../../etc/passwd",
        dry_run: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("rejects absolute probe_artifact_directory outside workspace_root", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const outsideWorkspace = path.join(
      path.parse(workspaceRoot).root,
      "outside-reconcile-probes",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: outsideWorkspace,
        dry_run: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("rejects a symlinked probe_artifact_directory that resolves outside workspace_root", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const outsideWorkspace = await createTemporaryWorkspace();
    const linkedProbeDir = path.join(workspaceRoot, "linked-probes");
    await symlink(
      outsideWorkspace,
      linkedProbeDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    const publisher = createMockPublisher();
    const { tool } = createTool({ publisher });

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        probe_artifact_directory: linkedProbeDir,
        dry_run: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  async function createTemporaryWorkspace(): Promise<string> {
    const ws = await mkdtemp(path.join(tmpdir(), "reconcile-backlog-"));
    temporaryWorkspaces.push(ws);
    return ws;
  }

  async function createWorkspaceWithValidProbeArtifact(): Promise<{
    workspaceRoot: string;
    probeDir: string;
  }> {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeDir = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeDir, { recursive: true });
    await writeValidProbeArtifact(probeDir, "api-probe.md", {
      probeScopeId: "api",
      inferredStatus: "implemented",
      confidenceScore: 0.9,
    });
    return { workspaceRoot, probeDir };
  }

  function createMockPublisher(): MockPublisher {
    return {
      publish: vi.fn().mockResolvedValue({
        counts: { created: 1, updated: 0, unchanged: 0, skipped: 0, errors: 0 },
        outcomes: [{ sourceId: "test", action: "created", workItemId: "wi-1" }],
      }),
    };
  }

  function createMockFindingPublisher(): MockFindingPublisher {
    return {
      publish: vi.fn().mockResolvedValue({
        counts: { created: 1, updated: 0, unchanged: 0, errors: 0 },
        outcomes: [
          { sourceId: "test", action: "created", findingId: "finding-1" },
        ],
      }),
    };
  }

  function createTool(overrides?: {
    publisher?: ReturnType<typeof createMockPublisher>;
    findingPublisher?: ReturnType<typeof createMockFindingPublisher>;
  }) {
    const publisher = overrides?.publisher ?? createMockPublisher();
    const findingPublisher =
      overrides?.findingPublisher ?? createMockFindingPublisher();
    const tool = new ReconcileImportedRepositoryBacklogTool(
      publisher as unknown as ReconciledWorkItemPublisher,
      findingPublisher as unknown as ImportedRepositoryFindingPublisher,
    );
    return { tool, publisher, findingPublisher };
  }
});

function expectPlanResult(result: Record<string, unknown>): PlanToolResult {
  expect(result).toMatchObject({ status: "plan" });
  expect(result.plan).toEqual(
    expect.objectContaining({
      counts: expect.any(Object),
      cycleDecision: expect.any(Object),
    }),
  );
  return result as PlanToolResult;
}

function expectPublishedResult(
  result: Record<string, unknown>,
): PublishedToolResult {
  expect(result).toMatchObject({ status: "published" });
  expect(result.plan).toEqual(
    expect.objectContaining({
      counts: expect.any(Object),
      cycleDecision: expect.any(Object),
    }),
  );
  expect(result.publish).toEqual(
    expect.objectContaining({ counts: expect.any(Object) }),
  );
  return result as PublishedToolResult;
}

function expectBlockedResult(
  result: Record<string, unknown>,
): BlockedToolResult {
  expect(result).toMatchObject({ status: "blocked" });
  return result as BlockedToolResult;
}

async function writeValidProbeArtifact(
  directory: string,
  fileName: string,
  options: {
    probeScopeId: string;
    inferredStatus: string;
    confidenceScore: number;
  },
): Promise<void> {
  await writeFile(
    path.join(directory, fileName),
    [
      "---",
      `project_scope_id: project-1`,
      `probe_scope_id: ${options.probeScopeId}`,
      "outcome: success",
      `inferred_status: ${options.inferredStatus}`,
      `confidence_score: ${options.confidenceScore}`,
      "evidence_refs:",
      "  - apps/api/src/main.ts",
      "---",
      "# Probe Result",
      "",
      "## Narrative Summary",
      "The capability exists with implementation evidence.",
      "",
    ].join("\n"),
    "utf-8",
  );
}
