# Tool Registry Mechanics: Dynamic Injection and Isolation

The tool registry stores API-backed and runner-backed tools that can be mounted into a Pi runner container for a workflow step. Mounting is separate from SDK-native tools such as `read`, `write`, `bash`, `ls`, `find`, and `grep`.

For the full runtime taxonomy, see `docs/research/tool-architecture.md`.

## 1. Dynamic Tool Generation

Tools are stored in PostgreSQL as registry rows with metadata, schemas, transport settings, and optional TypeScript snippets. When a workflow container is about to boot, `ToolMountingService` prepares a temporary host directory and mounts it into the runner as `/opt/pi-runner/extensions/`.

### 1.1. Tool File Structure

Each tool is written as a standalone TypeScript file.

**File: `/tmp/nexus-tools/<mountKey>/github_merge_pr.ts`**

```typescript
import { Type, ExtensionApi } from "@mariozechner/pi-coding-agent";

export default (pi: ExtensionApi) => {
  pi.registerTool({
    name: "github_merge_pr",
    description: "Merge a pull request on GitHub.",
    parameters: Type.Object({
      repo: Type.String(),
      pr_number: Type.Number(),
    }),
    execute: async (id, params) => {
      // Logic using GITHUB_TOKEN injected via environment variables
      return { content: [{ type: "text", text: "Successfully merged PR." }] };
    },
  });
};
```

## 2. Tool Discovery in `pi-runner`

When the Docker container starts, the runner scans `/opt/pi-runner/extensions/` and turns each mounted file into a `ToolDefinition`.

Modern mounted tools export metadata. `packages/pi-runner/src/session/mounted-tools.ts` reads that metadata and creates the executable SDK tool wrapper.

### 2.1. Discovery Logic

```typescript
import path from "path";
import fs from "fs";

async function discoverTools(extensionsDir: string, pi: ExtensionApi) {
  const files = fs.readdirSync(extensionsDir).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const extension = await import(path.join(extensionsDir, file));
    if (typeof extension.default === "function") {
      extension.default(pi);
    }
  }
}
```

The current Nexus runner path is metadata-based rather than direct `pi.registerTool()` registration for registry tools. Direct extension modules may still use SDK extension registration, but database-mounted tools go through `loadMountedToolDefinitions()`.

## 3. Validation Boundaries

Mounted tool calls are validated in layers:

1. `ToolDefinition.prepareArguments()` normalizes model-produced arguments before SDK validation.
2. The Pi SDK validates the prepared arguments against `ToolDefinition.parameters`.
3. The runner validates mounted API callback params with AJV before sending HTTP.
4. `executeApiCallback()` maps path and body fields from `api_callback` metadata.
5. The Nexus API controller validates the HTTP body with Zod.
6. The API service applies domain validation before mutating workflow state.

For example, `set_job_output` requires `data` to be a native object. If the model emits `data` as a JSON string, `prepareArguments()` must parse it before SDK validation. Later runner and API validation remain as defense in depth.

## 4. Tool Tier Isolation

Nexus enforces tool isolation based on the container tier (`Light` vs. `Heavy`). This is handled while the API selects and mounts tools for the workflow step.

| Tier      | Access Levels                         | Typical Tools                                                         |
| :-------- | :------------------------------------ | :-------------------------------------------------------------------- |
| **Light** | Ephemeral, Network-only               | `http_request`, `read_github_diff`, `slack_notify`, `spawn_subagent`. |
| **Heavy** | Stateful, File System, Full Toolchain | `bash`, `npm_test`, `docker_build`, `edit`, `git_commit`.             |

### 4.1. Security Enforcement

The AI agent cannot "jailbreak" its mounted toolset because unavailable registry tools are not mounted into the container. If `ToolMountingService` does not write the `github_merge_pr.ts` file into `/opt/pi-runner/extensions/`, the agent has no mounted tool definition for it and cannot call it.

## 5. Lifecycle of a Tool Mount

1.  **Workflow Step Analysis**: The `WorkflowEngine` identifies the tools required for the current step (e.g., `["bash", "git_commit"]`).
2.  **Temp Directory Creation**: `ToolMountingService` creates `/tmp/nexus-tools/<mountKey>/`.
3.  **Tool Materialization**: The service reads selected registry rows and writes mounted tool metadata/files to the temp directory.
4.  **Docker Provisioning**: The container runtime mounts this host directory to `/opt/pi-runner/extensions/` as a read-only volume.
5.  **Execution**: `pi-runner` boots, loads mounted tool definitions, and passes them to the Pi SDK session.
6.  **Cleanup**: After the container exits, the `WorkflowEngine` triggers the deletion of the temporary host directory.
