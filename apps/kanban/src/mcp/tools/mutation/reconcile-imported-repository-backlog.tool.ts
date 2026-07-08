import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  parseProbeResultArtifact,
  validateSuccessfulProbeResultArtifact,
} from "../../../orchestration/probe-result-artifact";
import {
  ImportedRepositoryBacklogReconciler,
  type ImportedRepositoryBacklogReconciliationPlan,
} from "../../../orchestration/imported-repository-backlog-reconciler";
import { ReconciledWorkItemPublisher } from "../../../orchestration/reconciled-work-item-publisher";
import { ImportedRepositoryFindingPublisher } from "../../../orchestration/imported-repository-finding-publisher";
import { ReconcileImportedRepositoryBacklogSchema } from "../shared/schemas";
import type { KanbanOrchestrationMode } from "../../../orchestration/human-decision-resolution-policy.types";
import type { HumanDecisionPolicy } from "../../../orchestration/human-decision-resolution-policy.types";

const DEFAULT_PROBE_ARTIFACT_DIRECTORY = "docs/project-context/probe-results";

type ReconcileParams = z.infer<typeof ReconcileImportedRepositoryBacklogSchema>;

interface BlockedDiagnostic {
  file_name: string;
  source_path: string;
  missing_fields: string[];
  errors: string[];
}

@Injectable()
export class ReconcileImportedRepositoryBacklogTool extends KanbanTool<ReconcileParams> {
  constructor(
    @Inject(ReconciledWorkItemPublisher)
    private readonly publisher: ReconciledWorkItemPublisher,
    @Inject(ImportedRepositoryFindingPublisher)
    private readonly findingPublisher: ImportedRepositoryFindingPublisher,
  ) {
    super("kanban.reconcile_imported_repository_backlog", {
      name: "kanban.reconcile_imported_repository_backlog",
      description:
        "Reconcile imported repository backlog from validated probe artifacts and optionally publish work items.",
      inputSchema: ReconcileImportedRepositoryBacklogSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    rawParams: unknown,
  ): Promise<Record<string, unknown>> {
    const params = ReconcileImportedRepositoryBacklogSchema.parse(rawParams);
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const workspaceRoot = await this.resolveExistingPath(params.workspace_root);
    const probeDirectory = await this.resolveProbeDirectory(
      workspaceRoot,
      params.probe_artifact_directory,
    );
    const dryRun = params.dry_run ?? false;

    const { markdownFiles, diagnostics, validArtifacts } =
      await this.loadAndValidateArtifacts(probeDirectory, workspaceRoot);

    if (diagnostics.length > 0) {
      return {
        ok: false,
        status: "blocked",
        reason: "invalid_probe_results",
        project_id: projectId,
        dry_run: dryRun,
        diagnostics,
      };
    }

    const orchestratorMode: KanbanOrchestrationMode | undefined =
      params.orchestration_mode;
    const decisionPolicy: HumanDecisionPolicy | undefined =
      params.human_decision_policy;

    const reconciler = new ImportedRepositoryBacklogReconciler();
    const plan = reconciler.reconcile({
      projectId,
      artifacts: validArtifacts,
      orchestrationMode: orchestratorMode,
      humanDecisionPolicy: decisionPolicy,
    });

    if (validArtifacts.length === 0 && markdownFiles.length === 0) {
      return {
        ok: false,
        status: "blocked",
        reason: "missing_probe_results",
        project_id: projectId,
        dry_run: dryRun,
        plan: this.buildPlanPayload(plan),
        cycleDecision: plan.cycleDecision,
        readyForCycle: false,
      };
    }

    if (dryRun) {
      return {
        ok: true,
        status: "plan",
        project_id: projectId,
        dry_run: true,
        plan: this.buildPlanPayload(plan),
        cycleDecision: plan.cycleDecision,
        readyForCycle: plan.cycleDecision.readyForCycle,
      };
    }

    if (orchestratorMode === "autonomous" && plan.findings.length > 0) {
      const probePath =
        params.probe_artifact_directory ?? DEFAULT_PROBE_ARTIFACT_DIRECTORY;
      const findingPublishResult = await this.findingPublisher.publish(
        plan.findings,
        projectId,
        probePath,
      );

      return {
        ok: true,
        status: "findings_recorded",
        project_id: projectId,
        dry_run: false,
        plan: this.buildPlanPayload(plan),
        cycleDecision: plan.cycleDecision,
        readyForCycle: false,
        publish: findingPublishResult,
      };
    }

    const publishResult = await this.publisher.publish(plan, projectId);

    return {
      ok: true,
      status: "published",
      project_id: projectId,
      dry_run: false,
      plan: this.buildPlanPayload(plan),
      cycleDecision: plan.cycleDecision,
      readyForCycle: plan.cycleDecision.readyForCycle,
      publish: publishResult,
    };
  }

  private async loadAndValidateArtifacts(
    probeDirectory: string,
    workspaceRoot: string,
  ): Promise<{
    markdownFiles: string[];
    diagnostics: BlockedDiagnostic[];
    validArtifacts: ReturnType<typeof parseProbeResultArtifact>[];
  }> {
    const markdownFiles = await this.listMarkdownFiles(probeDirectory);
    const diagnostics: BlockedDiagnostic[] = [];
    const validArtifacts: ReturnType<typeof parseProbeResultArtifact>[] = [];

    for (const filePath of markdownFiles) {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseProbeResultArtifact(content, filePath);

      if (parsed.outcome === "success") {
        const validation = validateSuccessfulProbeResultArtifact(
          content,
          filePath,
        );
        if (!validation.ok) {
          diagnostics.push({
            file_name: path.basename(filePath),
            source_path: path
              .relative(workspaceRoot, filePath)
              .replaceAll("\\", "/"),
            missing_fields: validation.missingFields,
            errors: validation.errors,
          });
          continue;
        }

        validArtifacts.push(validation.value);
        continue;
      }

      validArtifacts.push(parsed);
    }

    return { markdownFiles, diagnostics, validArtifacts };
  }

  private buildPlanPayload(
    plan: ImportedRepositoryBacklogReconciliationPlan,
  ): Record<string, unknown> {
    return {
      counts: plan.counts,
      summary: plan.summary,
      specs: plan.specs,
      findings: plan.findings,
      diagnostics: plan.diagnostics,
      cycleDecision: plan.cycleDecision,
      openQuestions: plan.openQuestions,
    };
  }

  private async resolveProbeDirectory(
    workspaceRoot: string,
    probeArtifactDirectory?: string,
  ): Promise<string> {
    const directory =
      probeArtifactDirectory ?? DEFAULT_PROBE_ARTIFACT_DIRECTORY;
    const resolved = path.isAbsolute(directory)
      ? path.resolve(directory)
      : path.resolve(workspaceRoot, directory);
    this.assertInsideWorkspace(workspaceRoot, resolved);

    const realProbeDirectory = await this.resolveExistingPath(resolved);
    this.assertInsideWorkspace(workspaceRoot, realProbeDirectory);

    return realProbeDirectory;
  }

  private assertInsideWorkspace(
    workspaceRoot: string,
    resolvedPath: string,
  ): void {
    const relative = path.relative(workspaceRoot, resolvedPath);

    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new BadRequestException(
        "kanban.reconcile_imported_repository_backlog probe_artifact_directory must be inside workspace_root",
      );
    }
  }

  private async resolveExistingPath(filePath: string): Promise<string> {
    try {
      return await realpath(path.resolve(filePath));
    } catch (error) {
      if (isMissingDirectoryError(error)) {
        return path.resolve(filePath);
      }

      throw error;
    }
  }

  private async listMarkdownFiles(directory: string): Promise<string[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(directory, entry.name))
        .filter((filePath) => filePath.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }
}

function isMissingDirectoryError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
