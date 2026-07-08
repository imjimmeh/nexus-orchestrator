import type { IInternalToolHandler } from "@nexus/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KanbanMcpManifestValidationService } from "./kanban-mcp-manifest-validation.service";
import { PublishSpecsTool } from "./tools/publish-specs/publish-specs.tool";
import * as MutationTools from "./tools/mutation";
import * as ReadTools from "./tools/read";

const REPOSITORY_ROOT = join(__dirname, "..", "..", "..", "..");

type ToolProviderConstructor = {
  readonly prototype: { getName(): string };
};

function createProviderStub(name: string): IInternalToolHandler {
  return {
    getName: () => name,
    getDefinition: () => ({
      name,
      description: `${name} test definition`,
      inputSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
      tierRestriction: 2,
      transport: "runner_local",
      runtimeOwner: "runner",
    }),
    execute: () => Promise.resolve({}),
  };
}

function readManifestTools(): Array<{ name: string }> {
  const manifest = JSON.parse(
    readFileSync(
      join(REPOSITORY_ROOT, "seed", "tool-manifests", "kanban-tools.seed.json"),
      "utf-8",
    ),
  ) as { toolNames?: string[] };

  return (manifest.toolNames ?? []).map((name) => ({ name }));
}

function collectRegisteredProviderNames(): string[] {
  const providerConstructors = [
    ...Object.values(ReadTools),
    ...Object.values(MutationTools),
    PublishSpecsTool,
  ].filter(
    (exp) => typeof exp === "function" && exp.prototype,
  ) as ToolProviderConstructor[];

  return providerConstructors
    .map((Provider) => {
      // Construct with no DI deps; the subclass constructor delegates to
      // `super(staticName, staticDefinition)` so `getName()` resolves to the
      // tool's registered name regardless of whether DI deps are wired up.
      const ProviderCtor =
        Provider as unknown as new () => IInternalToolHandler;
      const provider = new ProviderCtor();
      return provider.getName();
    })
    .sort((left, right) => left.localeCompare(right));
}

describe("KanbanMcpManifestValidationService", () => {
  it("reports manifest tools without providers and providers missing manifest entries", () => {
    const service = new KanbanMcpManifestValidationService();

    expect(
      service.validate({
        manifestTools: [{ name: "manifest.only" }, { name: "shared.tool" }],
        providers: [
          createProviderStub("provider.only"),
          createProviderStub("shared.tool"),
        ],
      }),
    ).toEqual({
      missingProviders: ["manifest.only"],
      missingManifestEntries: ["provider.only"],
    });
  });

  it("compares the seed manifest to currently registered Kanban MCP providers", () => {
    const service = new KanbanMcpManifestValidationService();
    const providers = collectRegisteredProviderNames().map(createProviderStub);

    expect(
      service.validate({
        manifestTools: readManifestTools(),
        providers,
      }),
    ).toEqual({
      missingProviders: ["steer_project", "validate_specs"],
      missingManifestEntries: [
        "kanban.control_plane_board",
        "kanban.goals",
        "kanban.project_brief",
        "kanban.review_decision",
        "kanban.todo_list",
        "kanban.work_item_restart_execution",
        "synthesize_discovery_work_item_specs",
      ],
    });
  });
});
