/** Tool names supported by mise-based runtime toolchain resolution. */
export const SUPPORTED_TOOLS = [
  "node",
  "python",
  "go",
  "rust",
  "java",
  "ruby",
  "deno",
  "bun",
  "dotnet",
  "php",
] as const;

/** A single language/tool toolchain entry resolvable by mise, e.g. python@3.12. */
export interface ToolchainSpec {
  /** mise tool name: 'python' | 'go' | 'rust' | 'node' | 'java' | 'ruby' | ... */
  tool: string;
  /** '3.12', '1.23', 'latest', or any mise-resolvable version spec. */
  version: string;
}

/** A named-volume cache mounted into the execution container. */
export interface CacheMountSpec {
  /** Maps to the Docker named volume `nexus-cache-<id>`. Charset: [a-z0-9-]. */
  id: string;
  /** Absolute container mount path. */
  path: string;
}

/** Fully resolved runtime environment config for a workflow execution container. */
export interface RuntimeToolchainConfig {
  toolchains: ToolchainSpec[];
  /** System-library escape hatch installed via apt (e.g. 'libpq-dev'). */
  aptPackages?: string[];
  /** User-added caches in addition to the built-in ecosystem presets. */
  caches?: CacheMountSpec[];
  /** Built-in preset cache ids to disable (e.g. 'apt'). */
  disableCaches?: string[];
}
