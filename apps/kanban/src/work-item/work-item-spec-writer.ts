import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface WorkItemSpecInput {
  id: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  scope?: string | null;
  status?: string | null;
  dependencyIds?: string[];
  executionConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Frontmatter keys emitted from dedicated, canonical sources (columns or
 * execution config) plus internal bookkeeping keys that must never surface as
 * authored frontmatter. Any other metadata key is round-tripped verbatim so the
 * regenerated spec stays lossless (e.g. `parent_context_id`, `ac_ids`).
 */
const NON_AUTHORED_METADATA_KEYS = new Set<string>([
  "item_id",
  "title",
  "priority",
  "scope",
  "status",
  "depends_on",
  "depends_on_item_ids",
  "agent_profile",
  "base_branch",
  "target_branch",
  "context_files",
  "source",
  "sourceId",
  "sourcePath",
  "sourceHash",
  "workItemMarkdownPath",
]);

interface WriteSpecResult {
  ok: boolean;
  filePath?: string;
  sourceHash?: string;
  error?: string;
}

const SPEC_DIR = "docs/work-items";

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringListValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function buildFrontmatter(
  input: WorkItemSpecInput,
  frontmatterId?: string,
): string[] {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`item_id: ${frontmatterId ?? input.id}`);
  lines.push(`title: ${input.title}`);
  lines.push(`priority: ${input.priority ?? "p2"}`);
  lines.push(`scope: ${input.scope ?? "standard"}`);
  lines.push(`status: ${input.status ?? "backlog"}`);

  if (input.dependencyIds && input.dependencyIds.length > 0) {
    lines.push("depends_on:");
    for (const depId of input.dependencyIds) {
      lines.push(`  - ${depId}`);
    }
  }

  const execConfig = input.executionConfig ?? {};
  const agentProfile = stringValue(execConfig["agent_profile"], "");
  const baseBranch = stringValue(execConfig["base_branch"], "");
  const targetBranch = stringValue(execConfig["target_branch"], "");
  const contextFiles = stringListValue(execConfig["context_files"]);

  if (agentProfile) lines.push(`agent_profile: ${agentProfile}`);
  if (baseBranch) lines.push(`base_branch: ${baseBranch}`);
  if (targetBranch) lines.push(`target_branch: ${targetBranch}`);
  if (contextFiles.length > 0) {
    lines.push("context_files:");
    for (const f of contextFiles) {
      lines.push(`  - ${f}`);
    }
  }

  lines.push(...buildCustomMetadataFrontmatter(input.metadata));

  return lines;
}

function buildCustomMetadataFrontmatter(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  if (!metadata) return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (NON_AUTHORED_METADATA_KEYS.has(key)) continue;
    const serialized = serializeFrontmatterValue(key, value);
    if (serialized) lines.push(...serialized);
  }
  return lines;
}

function serializeFrontmatterValue(
  key: string,
  value: unknown,
): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value.filter(
      (entry): entry is string | number | boolean =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
    );
    if (entries.length === 0) return undefined;
    return [`${key}:`, ...entries.map((entry) => `  - ${entry}`)];
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [`${key}: ${value}`];
  }
  return undefined;
}

function buildBody(input: WorkItemSpecInput): string[] {
  const lines: string[] = [];
  lines.push("");

  if (input.dependencyIds && input.dependencyIds.length > 0) {
    lines.push("## Dependencies");
    lines.push("");
    for (const depId of input.dependencyIds) {
      lines.push(`- ${depId}`);
    }
    lines.push("");
  }

  const execConfig = input.executionConfig ?? {};
  const agentProfile = stringValue(execConfig["agent_profile"], "default");
  const baseBranch = stringValue(execConfig["base_branch"], "main");
  const targetBranch = stringValue(
    execConfig["target_branch"],
    `feature/${input.id}`,
  );
  const contextFiles = stringListValue(execConfig["context_files"]);

  lines.push("## Execution Config");
  lines.push("");
  lines.push(`- Agent Profile: ${agentProfile}`);
  lines.push(`- Base Branch: ${baseBranch}`);
  lines.push(`- Target Branch: ${targetBranch}`);
  lines.push(
    `- Context Files: ${contextFiles.length > 0 ? contextFiles.join(", ") : "none"}`,
  );

  return lines;
}

function generateMarkdown(
  input: WorkItemSpecInput,
  frontmatterId?: string,
): string {
  const frontmatter = buildFrontmatter(input, frontmatterId);
  frontmatter.push("---");
  frontmatter.push("");
  frontmatter.push(input.description ?? "");

  const body = buildBody(input);
  frontmatter.push(...body);

  return frontmatter.join("\n") + "\n";
}

function computeSourceHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function writeWorkItemSpec(
  repoPath: string,
  input: WorkItemSpecInput,
  options?: { filePath?: string; frontmatterId?: string },
): Promise<WriteSpecResult> {
  try {
    const markdown = generateMarkdown(input, options?.frontmatterId);
    const specDir = path.join(repoPath, SPEC_DIR);

    await mkdir(specDir, { recursive: true });

    const filePath = options?.filePath ?? path.join(specDir, `${input.id}.md`);
    await writeFile(filePath, markdown, "utf-8");

    const sourceHash = computeSourceHash(markdown);

    return { ok: true, filePath, sourceHash };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export { generateMarkdown, computeSourceHash, writeWorkItemSpec, SPEC_DIR };
export type { WorkItemSpecInput, WriteSpecResult };
