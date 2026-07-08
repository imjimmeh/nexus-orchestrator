import { BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSpecFile } from "../publish-specs/spec-parser";
import { SynthesizeDiscoveryWorkItemSpecsTool } from "./synthesize-discovery-work-item-specs.tool";
import { SynthesizeDiscoveryWorkItemSpecsSchema } from "../shared/schemas";

describe("SynthesizeDiscoveryWorkItemSpecsTool", () => {
  const temporaryWorkspaces: string[] = [];
  const context = {} as InternalToolExecutionContext;

  afterEach(async () => {
    await Promise.all(
      temporaryWorkspaces.map((workspace) =>
        rm(workspace, { recursive: true, force: true }),
      ),
    );
    temporaryWorkspaces.length = 0;
  });

  it("writes a canonical bootstrap spec from investigation artifacts and goals", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const projectContextRoot = path.join(
      workspaceRoot,
      "docs",
      "project-context",
    );
    await mkdir(path.join(projectContextRoot, "probe-results"), {
      recursive: true,
    });
    await mkdir(path.join(workspaceRoot, "docs", "probes"), {
      recursive: true,
    });
    await writeFile(
      path.join(projectContextRoot, "CAPABILITY_MAP.md"),
      "# Capabilities\n",
      "utf-8",
    );
    await writeFile(
      path.join(projectContextRoot, "CODEBASE_HEALTH.md"),
      "# Health\n",
      "utf-8",
    );
    await writeFile(
      path.join(projectContextRoot, "OPEN_QUESTIONS.md"),
      "# Questions\n",
      "utf-8",
    );
    await writeFile(
      path.join(projectContextRoot, "ARCHITECTURE.md"),
      "# Architecture\n",
      "utf-8",
    );
    await writeFile(
      path.join(projectContextRoot, "probe-results", "api-probe.md"),
      "# API probe\n",
      "utf-8",
    );
    await writeFile(
      path.join(workspaceRoot, "docs", "probes", "ui-probe.md"),
      "# UI probe\n",
      "utf-8",
    );

    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      goals: ["Ship an initial vertical slice", "Keep hydration deterministic"],
    });

    const writtenFile = path.join(
      workspaceRoot,
      "docs",
      "work-items",
      "imported-repo-bootstrap.md",
    );
    const content = await readFile(writtenFile, "utf-8");

    expect(result).toMatchObject({
      ok: true,
      project_id: "imported-repo",
      spec_count: 1,
      output_directory: path.join(workspaceRoot, "docs", "work-items"),
      written_files: [writtenFile],
    });
    expect(result.source_artifact_count).toBeGreaterThanOrEqual(6);
    expect(
      parseSpecFile("imported-repo-bootstrap.md", content, writtenFile),
    ).toMatchObject({
      sourceId: "imported-repo-bootstrap",
      title: "Bootstrap imported repository execution plan",
      priority: "p0",
      scope: "large",
      sourcePath: writtenFile,
    });
    expect(content).toContain("item_id: imported-repo-bootstrap");
    expect(content).toContain(
      "title: Bootstrap imported repository execution plan",
    );
    expect(content).toContain("priority: p0");
    expect(content).toContain("scope: large");
    expect(content).toContain(
      "synthesized from codebase investigation artifacts",
    );
    expect(content).toContain("Ship an initial vertical slice");
    expect(content).toContain("Keep hydration deterministic");
  });

  it("writes the bootstrap spec from goals when optional artifact paths are absent", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const outputDirectory = path.join(workspaceRoot, "custom-work-items");
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      scope_id: "fallback-scope",
      workspace_root: workspaceRoot,
      output_directory: outputDirectory,
      goals: ["Create the first hydrated work item"],
    });

    const writtenFile = path.join(
      outputDirectory,
      "imported-repo-bootstrap.md",
    );
    const content = await readFile(writtenFile, "utf-8");

    expect(result).toMatchObject({
      ok: true,
      project_id: "fallback-scope",
      spec_count: 1,
      source_artifact_count: 0,
      output_directory: outputDirectory,
      written_files: [writtenFile],
    });
    expect(content).toContain("Create the first hydrated work item");
  });

  it("blocks synthesis when a successful probe result has no Narrative Summary section or legacy field", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeResultsRoot = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeResultsRoot, { recursive: true });
    await writeFile(
      path.join(probeResultsRoot, "api-probe.md"),
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
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      goals: ["Hydrate only validated findings"],
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: "invalid_probe_results",
      spec_count: 0,
      source_artifact_count: 1,
      invalid_probe_results: [
        {
          file_name: "api-probe.md",
          source_path: "docs/project-context/probe-results/api-probe.md",
          missing_fields: ["narrative_summary"],
        },
      ],
    });
    expect(JSON.stringify(result.invalid_probe_results)).not.toContain(
      workspaceRoot,
    );
  });

  it("does not validate unrelated markdown artifacts that only mention a successful outcome", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probesRoot = path.join(workspaceRoot, "docs", "probes");
    await mkdir(probesRoot, { recursive: true });
    await writeFile(
      path.join(probesRoot, "investigation-notes.md"),
      [
        "# Investigation notes",
        "",
        "outcome: success",
        "",
        "This is a narrative note, not a structured probe result artifact.",
        "",
      ].join("\n"),
      "utf-8",
    );
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      goals: ["Hydrate validated findings"],
    });

    expect(result).toMatchObject({
      ok: true,
      spec_count: 1,
      source_artifact_count: 1,
    });
  });

  it("allows synthesis when a successful probe result has a Narrative Summary markdown section", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeResultsRoot = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeResultsRoot, { recursive: true });
    await writeFile(
      path.join(probeResultsRoot, "api-probe.md"),
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
        "## Narrative Summary",
        "The API bootstrap exists and has implementation evidence.",
        "",
      ].join("\n"),
      "utf-8",
    );
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      goals: ["Hydrate validated findings"],
    });

    expect(result).toMatchObject({
      ok: true,
      spec_count: 1,
      source_artifact_count: 1,
    });
  });

  it("allows synthesis when a successful probe result has a legacy narrative_summary frontmatter field", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeResultsRoot = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeResultsRoot, { recursive: true });
    await writeFile(
      path.join(probeResultsRoot, "api-probe.md"),
      [
        "---",
        "project_scope_id: project-1",
        "probe_scope_id: api",
        "outcome: success",
        "inferred_status: implemented",
        "confidence_score: 0.9",
        "evidence_refs:",
        "  - apps/api/src/main.ts",
        "narrative_summary: Legacy machine-readable narrative.",
        "---",
        "# Probe Result: API",
        "",
      ].join("\n"),
      "utf-8",
    );
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      goals: ["Hydrate validated findings"],
    });

    expect(result).toMatchObject({
      ok: true,
      spec_count: 1,
      source_artifact_count: 1,
    });
  });

  it("blocks synthesis when a successful probe result has an empty Narrative Summary section", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const probeResultsRoot = path.join(
      workspaceRoot,
      "docs",
      "project-context",
      "probe-results",
    );
    await mkdir(probeResultsRoot, { recursive: true });
    await writeFile(
      path.join(probeResultsRoot, "api-probe.md"),
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
        "## Narrative Summary",
        "",
        "## Capability Updates",
        "- None.",
        "",
      ].join("\n"),
      "utf-8",
    );
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      workspace_root: workspaceRoot,
      goals: ["Hydrate validated findings"],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_probe_results",
      invalid_probe_results: [
        expect.objectContaining({ missing_fields: ["narrative_summary"] }),
      ],
    });
  });

  it("throws when neither project_id nor scope_id is provided", async () => {
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    await expect(tool.execute(context, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("derives project_id from context.scopeId when project_id and scope_id are omitted", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(
      { scopeId: "project-from-context" },
      { workspace_root: workspaceRoot },
    );

    expect(result.project_id).toBe("project-from-context");
  });

  it("uses scope_id when project_id is blank", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "   ",
      scope_id: "fallback-scope",
      workspace_root: workspaceRoot,
    });

    expect(result.project_id).toBe("fallback-scope");
  });

  it("uses scope_id when project_id is an empty string", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    const result = await tool.execute(context, {
      project_id: "",
      scope_id: "fallback-scope",
      workspace_root: workspaceRoot,
    });

    expect(result.project_id).toBe("fallback-scope");
  });

  it("rejects output directories outside the workspace root", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        workspace_root: workspaceRoot,
        output_directory: "../outside-workspace",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("defines a runner-local heavy MCP tool schema", () => {
    const tool = new SynthesizeDiscoveryWorkItemSpecsTool();

    expect(
      SynthesizeDiscoveryWorkItemSpecsSchema.parse({ goals: ["goal"] }),
    ).toEqual({
      goals: ["goal"],
    });
    expect(tool.getName()).toBe("synthesize_discovery_work_item_specs");
    expect(tool.getDefinition()).toMatchObject({
      name: "synthesize_discovery_work_item_specs",
      inputSchema: SynthesizeDiscoveryWorkItemSpecsSchema,
      tierRestriction: 2,
      transport: "runner_local",
      runtimeOwner: "runner",
    });
  });

  async function createTemporaryWorkspace(): Promise<string> {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "discovery-work-items-"),
    );
    temporaryWorkspaces.push(workspace);
    return workspace;
  }
});
