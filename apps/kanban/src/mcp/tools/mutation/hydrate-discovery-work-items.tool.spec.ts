import { BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HydrateDiscoveryWorkItemsSchema } from "../shared/schemas";
import { HydrateDiscoveryWorkItemsTool } from "./hydrate-discovery-work-items.tool";

describe("HydrateDiscoveryWorkItemsTool", () => {
  const temporaryWorkspaces: string[] = [];
  const context = {} as InternalToolExecutionContext;

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      temporaryWorkspaces.map((workspace) =>
        rm(workspace, { recursive: true, force: true }),
      ),
    );
    temporaryWorkspaces.length = 0;
  });

  it("returns a blocked result for missing specs when explicitly allowed", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const missingSpecDirectory = path.join(workspaceRoot, "docs", "work-items");
    const workItems = createMockWorkItemService();
    const tool = new HydrateDiscoveryWorkItemsTool(workItems);

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      spec_directory: missingSpecDirectory,
      allow_missing_specs: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: "missing_spec_directory",
      spec_count: 0,
      created_count: 0,
      updated_count: 0,
      skipped_count: 0,
      spec_directory: missingSpecDirectory,
      project_id: "imported-repo",
    });
    expect(workItems.createWorkItem).not.toHaveBeenCalled();
  });

  it("rejects a missing spec directory unless missing specs are explicitly allowed", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const missingSpecDirectory = path.join(workspaceRoot, "docs", "work-items");
    const tool = new HydrateDiscoveryWorkItemsTool(createMockWorkItemService());

    await expect(
      tool.execute(context, {
        project_id: "imported-repo",
        spec_directory: missingSpecDirectory,
      }),
    ).rejects.toThrow();
  });

  it("hydrates a parse-compatible spec from a valid spec directory", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const specDirectory = path.join(workspaceRoot, "docs", "work-items");
    await mkdir(specDirectory, { recursive: true });
    await writeFile(
      path.join(specDirectory, "imported-repo-bootstrap.md"),
      [
        "---",
        "item_id: imported-repo-bootstrap",
        "title: Bootstrap imported repository execution plan",
        "priority: p0",
        "scope: large",
        "---",
        "Create the first hydrated work item.",
      ].join("\n"),
      "utf-8",
    );
    const workItems = createMockWorkItemService();
    const tool = new HydrateDiscoveryWorkItemsTool(workItems);

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      spec_directory: specDirectory,
    });

    expect(result).toMatchObject({
      ok: true,
      hydrated_count: 1,
      created_count: 1,
      updated_count: 0,
      skipped_count: 0,
      spec_count: 1,
    });
    expect(workItems.createWorkItem).toHaveBeenCalledWith(
      "imported-repo",
      expect.objectContaining({
        title: "Bootstrap imported repository execution plan",
        description: "Create the first hydrated work item.",
        priority: "p0",
        scope: "large",
        metadata: expect.objectContaining({
          source: "hydrate_discovery_work_items",
          sourceId: "imported-repo-bootstrap",
          sourcePath: `${specDirectory.replaceAll("\\", "/")}/imported-repo-bootstrap.md`,
        }),
      }),
    );
  });

  it("continues hydrating valid specs when one spec file is malformed", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const specDirectory = path.join(workspaceRoot, "docs", "work-items");
    await mkdir(specDirectory, { recursive: true });
    await writeFile(
      path.join(specDirectory, "first-valid.md"),
      [
        "---",
        "item_id: first-valid",
        "title: First valid work item",
        "priority: p1",
        "scope: standard",
        "---",
        "Hydrate the first valid work item.",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(specDirectory, "malformed.md"),
      "title: Missing required frontmatter delimiters",
      "utf-8",
    );
    await writeFile(
      path.join(specDirectory, "second-valid.md"),
      [
        "---",
        "item_id: second-valid",
        "title: Second valid work item",
        "priority: p2",
        "scope: large",
        "---",
        "Hydrate the second valid work item.",
      ].join("\n"),
      "utf-8",
    );
    const workItems = createMockWorkItemService();
    const tool = new HydrateDiscoveryWorkItemsTool(workItems);

    const result = await tool.execute(context, {
      project_id: "imported-repo",
      spec_directory: specDirectory,
    });

    expect(result).toMatchObject({
      ok: true,
      hydrated_count: 2,
      created_count: 2,
      updated_count: 0,
      skipped_count: 1,
      skipped_files: ["malformed.md"],
      spec_count: 3,
      parse_errors: [
        {
          file_name: "malformed.md",
          source_path: `${specDirectory.replaceAll("\\", "/")}/malformed.md`,
          message: "Spec file is missing --- frontmatter",
        },
      ],
    });
    expect(workItems.createWorkItem).toHaveBeenCalledTimes(2);
    expect(workItems.createWorkItem).toHaveBeenCalledWith(
      "imported-repo",
      expect.objectContaining({ title: "First valid work item" }),
    );
    expect(workItems.createWorkItem).toHaveBeenCalledWith(
      "imported-repo",
      expect.objectContaining({ title: "Second valid work item" }),
    );
  });

  it("throws when neither project_id nor scope_id is provided", async () => {
    const tool = new HydrateDiscoveryWorkItemsTool(createMockWorkItemService());

    await expect(tool.execute(context, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("derives project_id from context.scopeId when project_id and scope_id are omitted", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const missingSpecDirectory = path.join(workspaceRoot, "docs", "work-items");
    const workItems = createMockWorkItemService();
    const tool = new HydrateDiscoveryWorkItemsTool(workItems);

    const result = await tool.execute(
      { scopeId: "project-from-context" },
      {
        spec_directory: missingSpecDirectory,
        allow_missing_specs: true,
      },
    );

    expect(result).toMatchObject({
      project_id: "project-from-context",
    });
  });

  it("accepts the explicit missing-spec option in the tool schema", () => {
    expect(
      HydrateDiscoveryWorkItemsSchema.parse({
        project_id: "imported-repo",
        allow_missing_specs: true,
      }),
    ).toMatchObject({ allow_missing_specs: true });
  });

  async function createTemporaryWorkspace(): Promise<string> {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "hydrate-discovery-work-items-"),
    );
    temporaryWorkspaces.push(workspace);
    return workspace;
  }

  function createMockWorkItemService() {
    return {
      listWorkItems: vi.fn().mockResolvedValue([]),
      createWorkItem: vi.fn().mockResolvedValue({ id: "work-item-1" }),
      updateWorkItem: vi.fn().mockResolvedValue({ id: "work-item-1" }),
    } as never;
  }
});
