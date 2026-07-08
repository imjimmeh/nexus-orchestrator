import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validateSuccessfulProbeResultArtifact } from "../../../orchestration/probe-result-artifact";
import { SynthesizeDiscoveryWorkItemSpecsSchema } from "../shared/schemas";

const DEFAULT_OUTPUT_DIRECTORY = "docs/work-items";
const OUTPUT_FILE_NAME = "imported-repo-bootstrap.md";
const PROJECT_CONTEXT_DIRECTORY = "docs/project-context";
const STATIC_ARTIFACT_PATHS = [
  "CAPABILITY_MAP.md",
  "CODEBASE_HEALTH.md",
  "OPEN_QUESTIONS.md",
];
const PROBE_ARTIFACT_DIRECTORIES = [
  "docs/project-context/probe-results",
  "docs/project-context/probe_results",
  "docs/probes",
  "probe_results",
];

type SynthesizeDiscoveryWorkItemSpecsParams = z.infer<
  typeof SynthesizeDiscoveryWorkItemSpecsSchema
>;

interface InvalidProbeResult {
  file_name: string;
  source_path: string;
  missing_fields: string[];
}

@Injectable()
export class SynthesizeDiscoveryWorkItemSpecsTool extends KanbanTool<SynthesizeDiscoveryWorkItemSpecsParams> {
  constructor() {
    super("synthesize_discovery_work_item_specs", {
      name: "synthesize_discovery_work_item_specs",
      description:
        "Synthesize canonical work-item specs from imported repository investigation artifacts before hydration.",
      inputSchema: SynthesizeDiscoveryWorkItemSpecsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    rawParams: unknown,
  ): Promise<Record<string, unknown>> {
    const params = SynthesizeDiscoveryWorkItemSpecsSchema.parse(rawParams);
    const projectId = this.resolveProjectId(params, context);
    const workspaceRoot = params.workspace_root ?? process.cwd();
    const outputDirectory = this.resolveOutputDirectory(
      workspaceRoot,
      params.output_directory,
    );
    const outputPath = path.join(outputDirectory, OUTPUT_FILE_NAME);
    const sourceArtifactCount = await this.countSourceArtifacts(workspaceRoot);
    const invalidProbeResults =
      await this.findInvalidSuccessfulProbeResults(workspaceRoot);

    if (invalidProbeResults.length > 0) {
      return {
        ok: false,
        status: "blocked",
        reason: "invalid_probe_results",
        project_id: projectId,
        spec_count: 0,
        source_artifact_count: sourceArtifactCount,
        invalid_probe_results: invalidProbeResults,
      };
    }

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      outputPath,
      this.renderBootstrapSpec(params.goals ?? []),
      "utf-8",
    );

    return {
      ok: true,
      project_id: projectId,
      spec_count: 1,
      source_artifact_count: sourceArtifactCount,
      output_directory: outputDirectory,
      written_files: [outputPath],
    };
  }

  private resolveProjectId(
    params: SynthesizeDiscoveryWorkItemSpecsParams,
    context: InternalToolExecutionContext,
  ): string {
    return resolveProjectIdFromToolContext({
      projectId:
        params.project_id?.trim() || params.scope_id?.trim() || undefined,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
  }

  private resolveOutputDirectory(
    workspaceRoot: string,
    outputDirectory?: string,
  ): string {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const requestedDirectory = outputDirectory ?? DEFAULT_OUTPUT_DIRECTORY;
    const resolvedOutputDirectory = path.isAbsolute(requestedDirectory)
      ? requestedDirectory
      : path.join(resolvedWorkspaceRoot, requestedDirectory);
    const relativeOutputPath = path.relative(
      resolvedWorkspaceRoot,
      path.resolve(resolvedOutputDirectory),
    );

    if (
      relativeOutputPath.startsWith("..") ||
      path.isAbsolute(relativeOutputPath)
    ) {
      throw new BadRequestException(
        "synthesize_discovery_work_item_specs output_directory must be inside workspace_root",
      );
    }

    return path.resolve(resolvedOutputDirectory);
  }

  private async countSourceArtifacts(workspaceRoot: string): Promise<number> {
    const artifactPaths = new Set<string>();
    const projectContextRoot = path.join(
      workspaceRoot,
      PROJECT_CONTEXT_DIRECTORY,
    );

    for (const artifactPath of STATIC_ARTIFACT_PATHS) {
      const fullPath = path.join(projectContextRoot, artifactPath);
      if (await this.isFile(fullPath)) {
        artifactPaths.add(fullPath);
      }
    }

    for (const artifactDirectory of PROBE_ARTIFACT_DIRECTORIES) {
      for (const markdownFile of await this.listMarkdownFiles(
        path.join(workspaceRoot, artifactDirectory),
      )) {
        artifactPaths.add(markdownFile);
      }
    }

    for (const markdownFile of await this.listMarkdownFiles(
      projectContextRoot,
    )) {
      artifactPaths.add(markdownFile);
    }

    return artifactPaths.size;
  }

  private async findInvalidSuccessfulProbeResults(
    workspaceRoot: string,
  ): Promise<InvalidProbeResult[]> {
    const invalidResults: InvalidProbeResult[] = [];
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    for (const artifactDirectory of PROBE_ARTIFACT_DIRECTORIES) {
      const directory = path.join(workspaceRoot, artifactDirectory);
      for (const markdownFile of await this.listMarkdownFiles(directory)) {
        if (!this.isProbeResultArtifact(workspaceRoot, markdownFile)) {
          continue;
        }

        const content = await readFile(markdownFile, "utf-8");
        if (!this.hasSuccessfulOutcome(content)) {
          continue;
        }

        const validation = validateSuccessfulProbeResultArtifact(
          content,
          markdownFile,
        );
        if (!validation.ok) {
          invalidResults.push({
            file_name: path.basename(markdownFile),
            source_path: path
              .relative(resolvedWorkspaceRoot, markdownFile)
              .replaceAll("\\", "/"),
            missing_fields: validation.missingFields,
          });
        }
      }
    }

    return invalidResults;
  }

  private isProbeResultArtifact(
    workspaceRoot: string,
    markdownFile: string,
  ): boolean {
    const relativePath = path
      .relative(path.resolve(workspaceRoot), markdownFile)
      .replaceAll("\\", "/");
    if (
      relativePath.startsWith("docs/project-context/probe-results/") ||
      relativePath.startsWith("docs/project-context/probe_results/") ||
      relativePath.startsWith("probe_results/")
    ) {
      return true;
    }

    const fileName = path.basename(markdownFile).toLowerCase();
    return (
      relativePath.startsWith("docs/probes/") &&
      /(^|-)probe(-result)?\.md$/u.test(fileName)
    );
  }

  private hasSuccessfulOutcome(content: string): boolean {
    return /^outcome\s*:\s*["']?success["']?\s*$/imu.test(content);
  }

  private async listMarkdownFiles(directory: string): Promise<string[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(directory, entry.name))
        .filter((filePath) => filePath.toLowerCase().endsWith(".md"))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  }

  private async isFile(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  private renderBootstrapSpec(goals: string[]): string {
    const goalsSection =
      goals.length > 0
        ? [
            "",
            "## Persisted Goals",
            "",
            ...goals.map((goal) => `- ${goal}`),
            "",
          ]
        : [""];

    return [
      "---",
      "item_id: imported-repo-bootstrap",
      "title: Bootstrap imported repository execution plan",
      "priority: p0",
      "scope: large",
      "---",
      "",
      "This work item was synthesized from codebase investigation artifacts to seed imported repository execution planning before hydration.",
      ...goalsSection,
    ].join("\n");
  }
}
