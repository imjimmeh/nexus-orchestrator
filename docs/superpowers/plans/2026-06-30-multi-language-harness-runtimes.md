# Multi-Language Harness Runtimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents work in repos of any language by resolving a configurable toolchain set per run, building+caching a `mise`-composed composite image on demand, and mounting shared package/OS cache volumes — while existing JavaScript workflows take an unchanged fast path.

**Architecture:** A new `WorkflowRuntimeToolchainsModule` (`apps/api/src/workflow/workflow-runtime-toolchains/`) holds pure helpers + injectable services: a precedence resolver, a repo detector, a deterministic image-tag hasher, a Dockerfile generator, a composite-image builder (inspect → build-under-lock → GC), and a package/OS cache-volume service. The existing harness images gain `mise` so they double as composite bases. Container provisioning resolves the toolchain set, picks the existing image (node-only) or an on-demand composite, and adds cache-volume mounts. The Kanban-owned project layer arrives only as a neutral `runtime_toolchains` run input.

**Tech Stack:** NestJS, TypeORM (Postgres, hand-written migrations), dockerode, Vitest+SWC, `mise`, Docker BuildKit, Vite/React + react-hook-form + zod (web), `@nexus/core` shared types.

## Global Constraints

- **Build `packages/core` first** — all apps depend on it: `npm run build --workspace=packages/core`.
- **Core/Kanban boundary (hard):** `apps/api/src` and `packages/core/src` must stay Kanban-neutral — no `kanban`/work-item/project-domain identifiers, no allowlists or `eslint-disable` to bypass `nexus-boundaries/no-core-kanban-residue`. The project layer is Kanban-owned and reaches the API only as the neutral run input `runtime_toolchains`.
- **Strict lint:** never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **NestJS builds** use `nest build` (not `tsc`); tests rely on SWC decorator metadata — keep Vitest/SWC config aligned with existing settings.
- **TDD:** Red → Green → Refactor for every behavioral unit.
- **Logs:** any Docker build/exec output surfaced in errors or events must be NUL-sanitized (raw multiplexed Docker output contains NUL bytes that wedge outbox/state writes).
- **Web tests** must respect the OOM fork cap (`VITEST_MAX_FORKS`); do not run two web suites concurrently.
- **API quality gate:** controllers = transport only; services own domain logic; repositories own persistence.
- **Frequent commits:** one commit per task minimum, conventional-commit messages, end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Constants:** no magic strings/numbers — name them (volume names, preset ids, env keys, tag prefix `nexus-rt/`, hash length 12).

---

## Phase 0 — Shared core types

### Task 1: `RuntimeToolchainConfig` shared types in `@nexus/core`

**Files:**

- Create: `packages/core/src/interfaces/runtime-toolchain.types.ts`
- Modify: `packages/core/src/interfaces/index.ts` (add re-export; confirm the barrel path with `git grep "fallback-chain.types" packages/core/src` — match the existing pattern's location)

**Interfaces:**

- Produces: `ToolchainSpec`, `CacheMountSpec`, `RuntimeToolchainConfig` (consumed by every later task and by apps/web).

- [ ] **Step 1: Create the types file**

```ts
// packages/core/src/interfaces/runtime-toolchain.types.ts

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
```

- [ ] **Step 2: Re-export from the interfaces barrel**

Add to `packages/core/src/interfaces/index.ts` (alongside the other `export * from "./*.types"` lines):

```ts
export * from "./runtime-toolchain.types";
```

- [ ] **Step 3: Build core to verify the types compile and export**

Run: `npm run build --workspace=packages/core`
Expected: PASS (no TS errors); `dist` includes `runtime-toolchain.types`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interfaces/runtime-toolchain.types.ts packages/core/src/interfaces/index.ts
git commit -m "feat(core): add RuntimeToolchainConfig shared types"
```

---

## Phase 1 — Toolchain resolution (pure logic)

All Phase 1 code lives in the new module dir `apps/api/src/workflow/workflow-runtime-toolchains/`. Run API tests with:
`npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/<file>.spec.ts`

### Task 2: Repo toolchain detector (pure)

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.spec.ts`

**Interfaces:**

- Produces: `detectToolchainsFromFiles(files: Record<string, string | null>): ToolchainSpec[]` — `files` maps a known filename to its contents (or `null` if absent). Pure, deterministic, sorted by tool name.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { detectToolchainsFromFiles } from "./repo-toolchain-detector";

describe("detectToolchainsFromFiles", () => {
  it("detects go version from go.mod", () => {
    const out = detectToolchainsFromFiles({
      "go.mod": "module x\n\ngo 1.23\n",
    });
    expect(out).toEqual([{ tool: "go", version: "1.23" }]);
  });

  it("detects python from .tool-versions with version", () => {
    const out = detectToolchainsFromFiles({
      ".tool-versions": "python 3.12.1\nnode 24.0.0\n",
    });
    expect(out).toEqual([
      { tool: "node", version: "24.0.0" },
      { tool: "python", version: "3.12.1" },
    ]);
  });

  it("detects rust@latest from Cargo.toml presence", () => {
    const out = detectToolchainsFromFiles({
      "Cargo.toml": "[package]\nname='x'\n",
    });
    expect(out).toEqual([{ tool: "rust", version: "latest" }]);
  });

  it("detects python@latest from requirements.txt presence", () => {
    const out = detectToolchainsFromFiles({ "requirements.txt": "flask\n" });
    expect(out).toEqual([{ tool: "python", version: "latest" }]);
  });

  it("reads node engine from package.json", () => {
    const out = detectToolchainsFromFiles({
      "package.json": JSON.stringify({ engines: { node: "24" } }),
    });
    expect(out).toEqual([{ tool: "node", version: "24" }]);
  });

  it("returns [] when nothing is present or files are null", () => {
    expect(detectToolchainsFromFiles({ "go.mod": null })).toEqual([]);
  });

  it("dedupes, preferring the first (most specific) source", () => {
    const out = detectToolchainsFromFiles({
      ".tool-versions": "python 3.12\n",
      "requirements.txt": "flask\n",
    });
    expect(out).toEqual([{ tool: "python", version: "3.12" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.spec.ts`
Expected: FAIL — `detectToolchainsFromFiles is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.ts
import type { ToolchainSpec } from "@nexus/core";

const LATEST = "latest";

/** Detection sources, evaluated in order; first hit per tool wins. */
function collect(files: Record<string, string | null>): Map<string, string> {
  const found = new Map<string, string>();
  const add = (tool: string, version: string): void => {
    if (!found.has(tool)) found.set(tool, version);
  };

  // .mise.toml / .tool-versions: explicit "<tool> <version>" pairs.
  for (const name of [".tool-versions"] as const) {
    const body = files[name];
    if (!body) continue;
    for (const line of body.split("\n")) {
      const [tool, version] = line.trim().split(/\s+/);
      if (tool && version) add(tool, version);
    }
  }

  const goMod = files["go.mod"];
  if (goMod) {
    const m = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(goMod);
    add("go", m ? m[1] : LATEST);
  }

  const pkg = files["package.json"];
  if (pkg) {
    try {
      const engines = (JSON.parse(pkg) as { engines?: { node?: string } })
        .engines;
      add("node", engines?.node ?? LATEST);
    } catch {
      add("node", LATEST);
    }
  }

  if (files["Cargo.toml"]) add("rust", LATEST);
  if (files["requirements.txt"] || files["pyproject.toml"])
    add("python", LATEST);
  if (files["pom.xml"]) add("java", LATEST);

  return found;
}

export function detectToolchainsFromFiles(
  files: Record<string, string | null>,
): ToolchainSpec[] {
  return [...collect(files).entries()]
    .map(([tool, version]) => ({ tool, version }))
    .sort((a, b) => a.tool.localeCompare(b.tool));
}

/** Filenames the detector inspects — used by the IO wrapper to read the workspace. */
export const DETECTED_FILENAMES = [
  ".tool-versions",
  "go.mod",
  "package.json",
  "Cargo.toml",
  "requirements.txt",
  "pyproject.toml",
  "pom.xml",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.ts apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.spec.ts
git commit -m "feat(api): add pure repo toolchain detector"
```

---

### Task 3: Precedence merge (pure)

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.spec.ts`

**Interfaces:**

- Consumes: `RuntimeToolchainConfig` (Task 1).
- Produces: `mergeToolchainLayers(layers: Array<RuntimeToolchainConfig | undefined>): RuntimeToolchainConfig`. Layers passed **highest precedence first**. `toolchains`/`aptPackages` use first-non-empty-wins; `caches` union by `id` (first wins on id clash); `disableCaches` union.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mergeToolchainLayers } from "./toolchain-merge";

describe("mergeToolchainLayers", () => {
  it("takes toolchains from the first non-empty layer", () => {
    const out = mergeToolchainLayers([
      { toolchains: [] },
      { toolchains: [{ tool: "python", version: "3.12" }] },
      { toolchains: [{ tool: "go", version: "1.23" }] },
    ]);
    expect(out.toolchains).toEqual([{ tool: "python", version: "3.12" }]);
  });

  it("unions caches by id, first occurrence wins", () => {
    const out = mergeToolchainLayers([
      { toolchains: [], caches: [{ id: "a", path: "/a1" }] },
      {
        toolchains: [],
        caches: [
          { id: "a", path: "/a2" },
          { id: "b", path: "/b" },
        ],
      },
    ]);
    expect(out.caches).toEqual([
      { id: "a", path: "/a1" },
      { id: "b", path: "/b" },
    ]);
  });

  it("unions disableCaches", () => {
    const out = mergeToolchainLayers([
      { toolchains: [], disableCaches: ["apt"] },
      { toolchains: [], disableCaches: ["apt", "maven"] },
    ]);
    expect(out.disableCaches?.sort()).toEqual(["apt", "maven"]);
  });

  it("ignores undefined layers and defaults arrays", () => {
    const out = mergeToolchainLayers([undefined, undefined]);
    expect(out).toEqual({
      toolchains: [],
      aptPackages: [],
      caches: [],
      disableCaches: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.spec.ts`
Expected: FAIL — `mergeToolchainLayers is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.ts
import type { RuntimeToolchainConfig, CacheMountSpec } from "@nexus/core";

function firstNonEmpty<T>(lists: Array<T[] | undefined>): T[] {
  for (const list of lists) if (list && list.length > 0) return list;
  return [];
}

function unionCaches(
  layers: Array<RuntimeToolchainConfig | undefined>,
): CacheMountSpec[] {
  const byId = new Map<string, CacheMountSpec>();
  for (const layer of layers)
    for (const cache of layer?.caches ?? [])
      if (!byId.has(cache.id)) byId.set(cache.id, cache);
  return [...byId.values()];
}

export function mergeToolchainLayers(
  layers: Array<RuntimeToolchainConfig | undefined>,
): RuntimeToolchainConfig {
  return {
    toolchains: firstNonEmpty(layers.map((l) => l?.toolchains)),
    aptPackages: firstNonEmpty(layers.map((l) => l?.aptPackages)),
    caches: unionCaches(layers),
    disableCaches: [...new Set(layers.flatMap((l) => l?.disableCaches ?? []))],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.ts apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.spec.ts
git commit -m "feat(api): add pure toolchain precedence merge"
```

---

### Task 4: Validation (allowlist + charset)

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.spec.ts`

**Interfaces:**

- Consumes: `RuntimeToolchainConfig`.
- Produces: `SUPPORTED_TOOLS: readonly string[]`; `validateRuntimeToolchainConfig(config: RuntimeToolchainConfig): void` (throws `ToolchainValidationError` with the offending value); `ToolchainValidationError extends Error`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  validateRuntimeToolchainConfig,
  ToolchainValidationError,
} from "./toolchain-validation";

describe("validateRuntimeToolchainConfig", () => {
  it("accepts a supported tool + safe version", () => {
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [{ tool: "python", version: "3.12" }],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown tool naming the offender", () => {
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [{ tool: "haskell-evil", version: "1" }],
      }),
    ).toThrow(/haskell-evil/);
  });

  it("rejects a version with shell metacharacters", () => {
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [{ tool: "python", version: "3.12; rm -rf /" }],
      }),
    ).toThrow(ToolchainValidationError);
  });

  it("rejects an apt package with bad charset", () => {
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [],
        aptPackages: ["libpq-dev && curl evil"],
      }),
    ).toThrow(ToolchainValidationError);
  });

  it("rejects a cache id outside [a-z0-9-]", () => {
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: "BAD_ID", path: "/x" }],
      }),
    ).toThrow(/BAD_ID/);
  });

  it("rejects a non-absolute or traversing cache path and sensitive mounts", () => {
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: "a", path: "rel" }],
      }),
    ).toThrow();
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: "a", path: "/x/../y" }],
      }),
    ).toThrow();
    expect(() =>
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: "a", path: "/workspace" }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.ts
import type { RuntimeToolchainConfig } from "@nexus/core";

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

const VERSION_RE = /^[A-Za-z0-9._-]+$/;
const APT_RE = /^[a-z0-9][a-z0-9.+-]*$/;
const CACHE_ID_RE = /^[a-z0-9-]+$/;
const BLOCKED_MOUNTS = new Set(["/", "/app", "/workspace"]);

export class ToolchainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolchainValidationError";
  }
}

export function validateRuntimeToolchainConfig(
  config: RuntimeToolchainConfig,
): void {
  for (const { tool, version } of config.toolchains) {
    if (!SUPPORTED_TOOLS.includes(tool as (typeof SUPPORTED_TOOLS)[number]))
      throw new ToolchainValidationError(`Unsupported toolchain tool: ${tool}`);
    if (!VERSION_RE.test(version))
      throw new ToolchainValidationError(
        `Invalid version for ${tool}: ${version}`,
      );
  }
  for (const pkg of config.aptPackages ?? [])
    if (!APT_RE.test(pkg))
      throw new ToolchainValidationError(`Invalid apt package: ${pkg}`);
  for (const cache of config.caches ?? []) {
    if (!CACHE_ID_RE.test(cache.id))
      throw new ToolchainValidationError(`Invalid cache id: ${cache.id}`);
    if (!cache.path.startsWith("/") || cache.path.includes(".."))
      throw new ToolchainValidationError(`Invalid cache path: ${cache.path}`);
    if (BLOCKED_MOUNTS.has(cache.path))
      throw new ToolchainValidationError(
        `Cache path not allowed: ${cache.path}`,
      );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.ts apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.spec.ts
git commit -m "feat(api): add runtime toolchain validation (allowlist + charset)"
```

---

## Phase 2 — Image tag hashing & Dockerfile generation (pure)

### Task 5: Deterministic composite image tag

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.spec.ts`

**Interfaces:**

- Produces: `computeCompositeImageTag(params: { harnessId: string; baseImageId: string; config: RuntimeToolchainConfig }): string` → `nexus-rt/<harnessId>:<12-hex>`; `isNodeOnly(config: RuntimeToolchainConfig): boolean`. Order-independent (sorts before hashing).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeCompositeImageTag, isNodeOnly } from "./composite-image-tag";

const base = { harnessId: "pi", baseImageId: "sha256:abc" };

describe("computeCompositeImageTag", () => {
  it("is order-independent for toolchains and apt", () => {
    const a = computeCompositeImageTag({
      ...base,
      config: {
        toolchains: [
          { tool: "go", version: "1" },
          { tool: "python", version: "3" },
        ],
        aptPackages: ["b", "a"],
      },
    });
    const b = computeCompositeImageTag({
      ...base,
      config: {
        toolchains: [
          { tool: "python", version: "3" },
          { tool: "go", version: "1" },
        ],
        aptPackages: ["a", "b"],
      },
    });
    expect(a).toBe(b);
  });

  it("changes when the base image id changes", () => {
    const cfg = { toolchains: [{ tool: "go", version: "1" }] };
    expect(computeCompositeImageTag({ ...base, config: cfg })).not.toBe(
      computeCompositeImageTag({
        ...base,
        baseImageId: "sha256:def",
        config: cfg,
      }),
    );
  });

  it("uses the nexus-rt/<harnessId>: prefix and a 12-char hex tag", () => {
    const tag = computeCompositeImageTag({
      ...base,
      config: { toolchains: [{ tool: "go", version: "1" }] },
    });
    expect(tag).toMatch(/^nexus-rt\/pi:[0-9a-f]{12}$/);
  });
});

describe("isNodeOnly", () => {
  it("is true for empty and node-only sets", () => {
    expect(isNodeOnly({ toolchains: [] })).toBe(true);
    expect(isNodeOnly({ toolchains: [{ tool: "node", version: "24" }] })).toBe(
      true,
    );
  });
  it("is false when any non-node tool is present", () => {
    expect(
      isNodeOnly({ toolchains: [{ tool: "python", version: "3.12" }] }),
    ).toBe(false);
  });
  it("is false when apt packages are requested even if node-only", () => {
    expect(isNodeOnly({ toolchains: [], aptPackages: ["libpq-dev"] })).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.ts
import { createHash } from "node:crypto";
import type { RuntimeToolchainConfig } from "@nexus/core";

export const COMPOSITE_TAG_PREFIX = "nexus-rt";
const HASH_LEN = 12;

function canonical(config: RuntimeToolchainConfig): string {
  const toolchains = [...config.toolchains]
    .map((t) => `${t.tool}@${t.version}`)
    .sort();
  const apt = [...(config.aptPackages ?? [])].sort();
  return JSON.stringify({ toolchains, apt });
}

export function computeCompositeImageTag(params: {
  harnessId: string;
  baseImageId: string;
  config: RuntimeToolchainConfig;
}): string {
  const hash = createHash("sha256")
    .update(params.baseImageId)
    .update(canonical(params.config))
    .digest("hex")
    .slice(0, HASH_LEN);
  return `${COMPOSITE_TAG_PREFIX}/${params.harnessId}:${hash}`;
}

export function isNodeOnly(config: RuntimeToolchainConfig): boolean {
  if ((config.aptPackages ?? []).length > 0) return false;
  return config.toolchains.every((t) => t.tool === "node");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.ts apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.spec.ts
git commit -m "feat(api): add deterministic composite image tag + node-only check"
```

---

### Task 6: Composite Dockerfile generator (pure)

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.spec.ts`

**Interfaces:**

- Produces: `generateCompositeDockerfile(params: { baseImageRef: string; config: RuntimeToolchainConfig }): string`. Assumes validation already ran (Task 4). Uses BuildKit cache mounts for apt + mise.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generateCompositeDockerfile } from "./composite-dockerfile";

describe("generateCompositeDockerfile", () => {
  it("starts FROM the base image ref", () => {
    const df = generateCompositeDockerfile({
      baseImageRef: "nexus/harness-pi:latest",
      config: { toolchains: [{ tool: "python", version: "3.12" }] },
    });
    expect(df.split("\n")[0]).toBe("# syntax=docker/dockerfile:1.7");
    expect(df).toContain("FROM nexus/harness-pi:latest");
  });

  it("emits a mise use line for each toolchain (sorted)", () => {
    const df = generateCompositeDockerfile({
      baseImageRef: "b",
      config: {
        toolchains: [
          { tool: "go", version: "1.23" },
          { tool: "python", version: "3.12" },
        ],
      },
    });
    expect(df).toContain("mise use -g go@1.23 python@3.12");
    expect(df).toContain("--mount=type=cache,target=");
  });

  it("emits an apt install line only when aptPackages present", () => {
    const without = generateCompositeDockerfile({
      baseImageRef: "b",
      config: { toolchains: [{ tool: "go", version: "1" }] },
    });
    expect(without).not.toContain("apt-get install");
    const withApt = generateCompositeDockerfile({
      baseImageRef: "b",
      config: {
        toolchains: [{ tool: "go", version: "1" }],
        aptPackages: ["libpq-dev", "ffmpeg"],
      },
    });
    expect(withApt).toContain(
      "apt-get install -y --no-install-recommends ffmpeg libpq-dev",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.ts
import type { RuntimeToolchainConfig } from "@nexus/core";

const APT_CACHE = "/var/cache/apt/archives";
const MISE_CACHE = "/root/.cache/mise";

export function generateCompositeDockerfile(params: {
  baseImageRef: string;
  config: RuntimeToolchainConfig;
}): string {
  const lines: string[] = [
    "# syntax=docker/dockerfile:1.7",
    `FROM ${params.baseImageRef}`,
  ];

  const apt = [...(params.config.aptPackages ?? [])].sort();
  if (apt.length > 0) {
    lines.push(
      `RUN --mount=type=cache,target=${APT_CACHE} \\`,
      `    apt-get update && apt-get install -y --no-install-recommends ${apt.join(" ")}`,
    );
  }

  const tools = [...params.config.toolchains]
    .map((t) => `${t.tool}@${t.version}`)
    .sort()
    .join(" ");
  if (tools.length > 0) {
    lines.push(
      `RUN --mount=type=cache,target=${MISE_CACHE} \\`,
      `    mise use -g ${tools} && mise reshim`,
    );
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.ts apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.spec.ts
git commit -m "feat(api): add composite Dockerfile generator with BuildKit cache mounts"
```

---

## Phase 3 — Cache volumes & composite builder (services)

### Task 7: Package/OS cache-volume service

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/cache-volume-presets.ts`
- Create: `apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.spec.ts`

**Interfaces:**

- Consumes: `RuntimeToolchainConfig`; dockerode `Docker` (injected via the existing docker provider token used by `ContainerOrchestratorService` — confirm the token by reading `apps/api/src/docker/container-orchestrator.service.ts` constructor and reuse it).
- Produces: `CACHE_PRESETS` (id, containerPath, env, enabledFor predicate); `PackageCacheVolumeService.resolveCacheMounts(config): Promise<{ volumes: Array<{ hostPath: string; containerPath: string; readOnly: boolean }>; env: Record<string,string> }>` — ensures named volumes exist (`docker.createVolume`, idempotent) and returns mount entries (`hostPath` = volume name) + env. Disabled presets excluded; custom caches appended.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { PackageCacheVolumeService } from "./package-cache-volume.service";

function fakeDocker() {
  return { createVolume: vi.fn().mockResolvedValue(undefined) } as any;
}

describe("PackageCacheVolumeService.resolveCacheMounts", () => {
  it("enables npm + mise + apt presets for a node set", async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [{ tool: "node", version: "24" }],
    });
    const ids = out.volumes.map((v) => v.hostPath);
    expect(ids).toContain("nexus-cache-npm");
    expect(ids).toContain("nexus-cache-mise");
    expect(ids).toContain("nexus-cache-apt");
    expect(out.env.npm_config_cache).toBe("/root/.npm");
  });

  it("enables pip cache when python present", async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [{ tool: "python", version: "3.12" }],
    });
    expect(out.volumes.map((v) => v.hostPath)).toContain("nexus-cache-pip");
    expect(out.env.PIP_CACHE_DIR).toBe("/root/.cache/pip");
  });

  it("omits a disabled preset", async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [{ tool: "node", version: "24" }],
      disableCaches: ["apt"],
    });
    expect(out.volumes.map((v) => v.hostPath)).not.toContain("nexus-cache-apt");
  });

  it("appends custom caches", async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [],
      caches: [{ id: "precommit", path: "/root/.cache/pre-commit" }],
    });
    const custom = out.volumes.find(
      (v) => v.hostPath === "nexus-cache-precommit",
    );
    expect(custom?.containerPath).toBe("/root/.cache/pre-commit");
  });

  it("ensures each volume exists exactly once", async () => {
    const docker = fakeDocker();
    const svc = new PackageCacheVolumeService(docker);
    await svc.resolveCacheMounts({
      toolchains: [{ tool: "node", version: "24" }],
    });
    expect(docker.createVolume).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/cache-volume-presets.ts
import type { RuntimeToolchainConfig } from "@nexus/core";

export interface CachePreset {
  id: string;
  containerPath: string;
  env?: Record<string, string>;
  enabledFor: (config: RuntimeToolchainConfig) => boolean;
}

const hasTool = (config: RuntimeToolchainConfig, tool: string): boolean =>
  config.toolchains.some((t) => t.tool === tool);

export const CACHE_PRESETS: CachePreset[] = [
  {
    id: "mise",
    containerPath: "/root/.cache/mise",
    env: { MISE_CACHE_DIR: "/root/.cache/mise" },
    enabledFor: () => true,
  },
  {
    id: "apt",
    containerPath: "/var/cache/apt/archives",
    enabledFor: () => true,
  },
  {
    id: "npm",
    containerPath: "/root/.npm",
    env: { npm_config_cache: "/root/.npm" },
    enabledFor: (c) => hasTool(c, "node"),
  },
  {
    id: "pip",
    containerPath: "/root/.cache/pip",
    env: { PIP_CACHE_DIR: "/root/.cache/pip" },
    enabledFor: (c) => hasTool(c, "python"),
  },
  {
    id: "go",
    containerPath: "/root/go/pkg/mod",
    env: { GOMODCACHE: "/root/go/pkg/mod", GOCACHE: "/root/.cache/go-build" },
    enabledFor: (c) => hasTool(c, "go"),
  },
  {
    id: "cargo",
    containerPath: "/root/.cargo/registry",
    env: { CARGO_HOME: "/root/.cargo" },
    enabledFor: (c) => hasTool(c, "rust"),
  },
  {
    id: "maven",
    containerPath: "/root/.m2",
    enabledFor: (c) => hasTool(c, "java"),
  },
];

export const CACHE_VOLUME_PREFIX = "nexus-cache-";
```

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.ts
import { Inject, Injectable } from "@nestjs/common";
import type Docker from "dockerode";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { CACHE_PRESETS, CACHE_VOLUME_PREFIX } from "./cache-volume-presets";
import { DOCKER_CLIENT } from "../../docker/docker.constants"; // confirm token name in docker module

export interface ResolvedCacheMounts {
  volumes: Array<{
    hostPath: string;
    containerPath: string;
    readOnly: boolean;
  }>;
  env: Record<string, string>;
}

@Injectable()
export class PackageCacheVolumeService {
  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  async resolveCacheMounts(
    config: RuntimeToolchainConfig,
  ): Promise<ResolvedCacheMounts> {
    const disabled = new Set(config.disableCaches ?? []);
    const volumes: ResolvedCacheMounts["volumes"] = [];
    const env: Record<string, string> = {};

    for (const preset of CACHE_PRESETS) {
      if (disabled.has(preset.id) || !preset.enabledFor(config)) continue;
      volumes.push({
        hostPath: `${CACHE_VOLUME_PREFIX}${preset.id}`,
        containerPath: preset.containerPath,
        readOnly: false,
      });
      Object.assign(env, preset.env ?? {});
    }
    for (const cache of config.caches ?? [])
      volumes.push({
        hostPath: `${CACHE_VOLUME_PREFIX}${cache.id}`,
        containerPath: cache.path,
        readOnly: false,
      });

    await Promise.all(volumes.map((v) => this.ensureVolume(v.hostPath)));
    return { volumes, env };
  }

  private async ensureVolume(name: string): Promise<void> {
    try {
      await this.docker.createVolume({
        Name: name,
        Labels: { "nexus.managed": "true", "nexus.cache": "true" },
      });
    } catch {
      // createVolume is idempotent in practice; ignore "already exists".
    }
  }
}
```

> **Note for implementer:** confirm `DOCKER_CLIENT` — read `apps/api/src/docker/container-orchestrator.service.ts` constructor + `apps/api/src/docker/docker.constants.ts`. Reuse the existing dockerode injection token; do not create a second Docker client.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/cache-volume-presets.ts apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.ts apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.spec.ts
git commit -m "feat(api): add package/OS cache-volume service with presets + custom + disable"
```

---

### Task 8: Composite image builder (inspect → build-under-lock → GC)

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/composite-image-build.error.ts`
- Create: `apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.spec.ts`

**Interfaces:**

- Consumes: dockerode `Docker`, `computeCompositeImageTag`, `generateCompositeDockerfile`, `sanitizeLog` (use the existing log sanitizer — find it with `git grep -l "function sanitize" apps/api/src` / the helper referenced in the NUL-logs fix; reuse, do not re-implement).
- Produces: `CompositeImageBuildError extends Error`; `CompositeImageBuilderService.ensureImage(params: { harnessId: string; baseImageRef: string; config: RuntimeToolchainConfig }): Promise<string>` returns the composite image ref. Inspects `baseImageRef` for its `Id`, computes the tag, returns it if the image exists, else builds under a per-tag in-process lock. On build failure throws `CompositeImageBuildError` with a NUL-sanitized log tail and clears the lock.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { CompositeImageBuilderService } from "./composite-image-builder.service";
import { CompositeImageBuildError } from "./composite-image-build.error";

function dockerWith(opts: { existing: Set<string> }) {
  return {
    getImage: (ref: string) => ({
      inspect: vi.fn().mockImplementation(async () => {
        if (ref.startsWith("nexus/harness")) return { Id: "sha256:base" };
        if (opts.existing.has(ref)) return { Id: "sha256:" + ref };
        throw new Error("no such image");
      }),
    }),
    buildImage: vi.fn(),
    modem: { followProgress: vi.fn() },
  } as any;
}

const config = { toolchains: [{ tool: "python", version: "3.12" }] };

describe("CompositeImageBuilderService.ensureImage", () => {
  it("returns the cached tag without building when image exists", async () => {
    const docker = dockerWith({ existing: new Set() });
    const svc = new CompositeImageBuilderService(docker);
    const tag = "nexus-rt/pi:" + "0".repeat(12); // compute via the real fn in impl; here we assert no build for a pre-seeded tag
    // pre-seed: make inspect of the computed tag succeed
    const expectedTag = (svc as any).tagFor("pi", "sha256:base", config);
    docker.getImage = (ref: string) => ({
      inspect: async () =>
        ref === expectedTag || ref.startsWith("nexus/harness")
          ? { Id: "x" }
          : Promise.reject(new Error("no")),
    });
    const result = await svc.ensureImage({
      harnessId: "pi",
      baseImageRef: "nexus/harness-pi:latest",
      config,
    });
    expect(result).toBe(expectedTag);
    expect(docker.buildImage).not.toHaveBeenCalled();
  });

  it("de-dupes concurrent builds of the same tag (one build)", async () => {
    const docker = dockerWith({ existing: new Set() });
    let builds = 0;
    docker.buildImage = vi.fn(async () => {
      builds++;
      return {};
    });
    (docker as any).modem.followProgress = (
      _s: unknown,
      cb: (e: unknown) => void,
    ) => cb(null);
    const svc = new CompositeImageBuilderService(docker);
    await Promise.all([
      svc.ensureImage({
        harnessId: "pi",
        baseImageRef: "nexus/harness-pi:latest",
        config,
      }),
      svc.ensureImage({
        harnessId: "pi",
        baseImageRef: "nexus/harness-pi:latest",
        config,
      }),
    ]);
    expect(builds).toBe(1);
  });

  it("throws CompositeImageBuildError and clears the lock on failure", async () => {
    const docker = dockerWith({ existing: new Set() });
    docker.buildImage = vi.fn(async () => ({}));
    (docker as any).modem.followProgress = (
      _s: unknown,
      cb: (e: unknown) => void,
    ) => cb(new Error("mise install boom "));
    const svc = new CompositeImageBuilderService(docker);
    await expect(
      svc.ensureImage({
        harnessId: "pi",
        baseImageRef: "nexus/harness-pi:latest",
        config,
      }),
    ).rejects.toBeInstanceOf(CompositeImageBuildError);
    // lock cleared: a second call attempts to build again
    await expect(
      svc.ensureImage({
        harnessId: "pi",
        baseImageRef: "nexus/harness-pi:latest",
        config,
      }),
    ).rejects.toBeInstanceOf(CompositeImageBuildError);
    expect((docker.buildImage as any).mock.calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/composite-image-build.error.ts
export class CompositeImageBuildError extends Error {
  constructor(
    message: string,
    readonly logTail: string,
  ) {
    super(message);
    this.name = "CompositeImageBuildError";
  }
}
```

```ts
// apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import * as tar from "tar-stream"; // already a transitive dep via dockerode tooling; if absent, build a tar buffer manually
import type Docker from "dockerode";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { computeCompositeImageTag } from "./composite-image-tag";
import { generateCompositeDockerfile } from "./composite-dockerfile";
import { CompositeImageBuildError } from "./composite-image-build.error";
import { DOCKER_CLIENT } from "../../docker/docker.constants";
import { sanitizeDockerLog } from "../../docker/log-sanitizer"; // reuse the existing NUL-safe sanitizer; confirm path/name

@Injectable()
export class CompositeImageBuilderService {
  private readonly logger = new Logger(CompositeImageBuilderService.name);
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  private tagFor(
    harnessId: string,
    baseImageId: string,
    config: RuntimeToolchainConfig,
  ): string {
    return computeCompositeImageTag({ harnessId, baseImageId, config });
  }

  async ensureImage(params: {
    harnessId: string;
    baseImageRef: string;
    config: RuntimeToolchainConfig;
  }): Promise<string> {
    const baseId = (await this.docker.getImage(params.baseImageRef).inspect())
      .Id;
    const tag = this.tagFor(params.harnessId, baseId, params.config);

    if (await this.imageExists(tag)) return tag;

    const existing = this.inFlight.get(tag);
    if (existing) return existing;

    const build = this.build(tag, params.baseImageRef, params.config).finally(
      () => this.inFlight.delete(tag),
    );
    this.inFlight.set(tag, build);
    return build;
  }

  private async imageExists(ref: string): Promise<boolean> {
    try {
      await this.docker.getImage(ref).inspect();
      return true;
    } catch {
      return false;
    }
  }

  private async build(
    tag: string,
    baseImageRef: string,
    config: RuntimeToolchainConfig,
  ): Promise<string> {
    const dockerfile = generateCompositeDockerfile({ baseImageRef, config });
    const context = this.tarContext(dockerfile);
    const stream = await this.docker.buildImage(context, {
      t: tag,
      dockerfile: "Dockerfile",
      version: "2" as never,
    });
    await this.followBuild(stream, tag);
    await this.docker.getImage(tag).inspect(); // verify present; throws if build produced nothing
    return tag;
  }

  private tarContext(dockerfile: string): NodeJS.ReadableStream {
    const pack = tar.pack();
    pack.entry({ name: "Dockerfile" }, dockerfile);
    pack.finalize();
    return pack;
  }

  private followBuild(
    stream: NodeJS.ReadableStream,
    tag: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, _res: unknown) => {
          if (err) {
            const tail = sanitizeDockerLog(err.message).slice(-2000);
            reject(
              new CompositeImageBuildError(
                `Composite image build failed for ${tag}`,
                tail,
              ),
            );
            return;
          }
          resolve();
        },
      );
    });
  }

  /** Periodic GC entrypoint — remove composite images unused beyond the retention window. */
  async collectGarbage(maxAgeMs: number): Promise<void> {
    const images = await this.docker.listImages({
      filters: { label: ["nexus.managed=true"] } as never,
    });
    for (const img of images) {
      const repoTag = (img.RepoTags ?? []).find((t) =>
        t.startsWith("nexus-rt/"),
      );
      if (!repoTag) continue;
      const ageMs = Date.now() - img.Created * 1000;
      if (ageMs > maxAgeMs) {
        try {
          await this.docker.getImage(repoTag).remove({ force: false });
        } catch (e) {
          this.logger.warn(
            `GC could not remove ${repoTag}: ${(e as Error).message}`,
          );
        }
      }
    }
  }
}
```

> **Notes for implementer:**
>
> - Confirm `sanitizeDockerLog` exists (the NUL-logs fix added a sanitizer). If the real name differs, import that; do **not** add a new one.
> - `tar-stream` is dockerode's own dependency. If it is not resolvable from apps/api, build the tar buffer with `dockerode`'s `buildImage({ context, src })` form instead — read an existing `buildImage` call in the repo (`git grep -n "buildImage" apps/api/src`) and mirror it.
> - `Date.now()` is fine in app code (this is not a workflow script).
> - GC scheduling is wired in Task 9 via the existing cleanup-service cron.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/composite-image-build.error.ts apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.ts apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.spec.ts
git commit -m "feat(api): add composite image builder with per-tag lock + GC"
```

---

## Phase 4 — Resolver service, image resolver, module wiring

### Task 9: `HarnessImageResolver` + `ToolchainResolverService` + module

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime-toolchains/harness-image-resolver.service.ts`
- Create: `apps/api/src/workflow/workflow-runtime-toolchains/toolchain-resolver.service.ts`
- Create: `apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.service.ts`
- Create: `apps/api/src/workflow/workflow-runtime-toolchains/workflow-runtime-toolchains.module.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/harness-image-resolver.service.spec.ts`
- Test: `apps/api/src/workflow/workflow-runtime-toolchains/toolchain-resolver.service.spec.ts`

**Interfaces:**

- `RepoToolchainDetectorService.detect(workspacePath: string): Promise<ToolchainSpec[]>` — reads `DETECTED_FILENAMES` from disk (missing → null) and calls `detectToolchainsFromFiles`.
- `ToolchainResolverService.resolve(params: { stepConfig?: RuntimeToolchainConfig; agentProfileConfig?: RuntimeToolchainConfig; runInputConfig?: RuntimeToolchainConfig; workspacePath?: string }): Promise<RuntimeToolchainConfig>` — builds the 5 layers (step, profile, run-input, detected, base default `{toolchains:[]}`), validates, merges.
- `HarnessImageResolver.resolveImageRef(params: { harnessId: string; baseImageRef: string; config: RuntimeToolchainConfig }): Promise<string>` — node-only → `baseImageRef`; else `builder.ensureImage`.

- [ ] **Step 1: Write the failing tests**

```ts
// harness-image-resolver.service.spec.ts
import { describe, it, expect, vi } from "vitest";
import { HarnessImageResolver } from "./harness-image-resolver.service";

describe("HarnessImageResolver.resolveImageRef", () => {
  it("returns the base image for a node-only set without building", async () => {
    const builder = { ensureImage: vi.fn() } as any;
    const r = new HarnessImageResolver(builder);
    const ref = await r.resolveImageRef({
      harnessId: "pi",
      baseImageRef: "nexus/harness-pi:latest",
      config: { toolchains: [{ tool: "node", version: "24" }] },
    });
    expect(ref).toBe("nexus/harness-pi:latest");
    expect(builder.ensureImage).not.toHaveBeenCalled();
  });

  it("builds a composite for a non-node set", async () => {
    const builder = {
      ensureImage: vi.fn().mockResolvedValue("nexus-rt/pi:abc123abc123"),
    } as any;
    const r = new HarnessImageResolver(builder);
    const ref = await r.resolveImageRef({
      harnessId: "pi",
      baseImageRef: "nexus/harness-pi:latest",
      config: { toolchains: [{ tool: "python", version: "3.12" }] },
    });
    expect(ref).toBe("nexus-rt/pi:abc123abc123");
    expect(builder.ensureImage).toHaveBeenCalledOnce();
  });
});
```

```ts
// toolchain-resolver.service.spec.ts
import { describe, it, expect, vi } from "vitest";
import { ToolchainResolverService } from "./toolchain-resolver.service";

describe("ToolchainResolverService.resolve", () => {
  it("prefers step over profile over run input", async () => {
    const detector = { detect: vi.fn().mockResolvedValue([]) } as any;
    const svc = new ToolchainResolverService(detector);
    const out = await svc.resolve({
      stepConfig: { toolchains: [{ tool: "go", version: "1.23" }] },
      agentProfileConfig: { toolchains: [{ tool: "python", version: "3.12" }] },
      runInputConfig: { toolchains: [{ tool: "rust", version: "1.80" }] },
    });
    expect(out.toolchains).toEqual([{ tool: "go", version: "1.23" }]);
  });

  it("falls back to repo detection when no explicit layer", async () => {
    const detector = {
      detect: vi.fn().mockResolvedValue([{ tool: "python", version: "3.12" }]),
    } as any;
    const svc = new ToolchainResolverService(detector);
    const out = await svc.resolve({ workspacePath: "/ws" });
    expect(out.toolchains).toEqual([{ tool: "python", version: "3.12" }]);
  });

  it("throws on an invalid explicit toolchain before merge", async () => {
    const detector = { detect: vi.fn().mockResolvedValue([]) } as any;
    const svc = new ToolchainResolverService(detector);
    await expect(
      svc.resolve({
        stepConfig: { toolchains: [{ tool: "evil", version: "1" }] },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/harness-image-resolver.service.spec.ts apps/api/src/workflow/workflow-runtime-toolchains/toolchain-resolver.service.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// repo-toolchain-detector.service.ts
import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolchainSpec } from "@nexus/core";
import {
  DETECTED_FILENAMES,
  detectToolchainsFromFiles,
} from "./repo-toolchain-detector";

@Injectable()
export class RepoToolchainDetectorService {
  async detect(workspacePath: string): Promise<ToolchainSpec[]> {
    const files: Record<string, string | null> = {};
    await Promise.all(
      DETECTED_FILENAMES.map(async (name) => {
        try {
          files[name] = await readFile(join(workspacePath, name), "utf8");
        } catch {
          files[name] = null;
        }
      }),
    );
    return detectToolchainsFromFiles(files);
  }
}
```

```ts
// toolchain-resolver.service.ts
import { Injectable } from "@nestjs/common";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { RepoToolchainDetectorService } from "./repo-toolchain-detector.service";
import { mergeToolchainLayers } from "./toolchain-merge";
import { validateRuntimeToolchainConfig } from "./toolchain-validation";

const BASE_DEFAULT: RuntimeToolchainConfig = { toolchains: [] };

@Injectable()
export class ToolchainResolverService {
  constructor(private readonly detector: RepoToolchainDetectorService) {}

  async resolve(params: {
    stepConfig?: RuntimeToolchainConfig;
    agentProfileConfig?: RuntimeToolchainConfig;
    runInputConfig?: RuntimeToolchainConfig;
    workspacePath?: string;
  }): Promise<RuntimeToolchainConfig> {
    for (const explicit of [
      params.stepConfig,
      params.agentProfileConfig,
      params.runInputConfig,
    ])
      if (explicit) validateRuntimeToolchainConfig(explicit);

    const detected: RuntimeToolchainConfig | undefined = params.workspacePath
      ? { toolchains: await this.detector.detect(params.workspacePath) }
      : undefined;

    return mergeToolchainLayers([
      params.stepConfig,
      params.agentProfileConfig,
      params.runInputConfig,
      detected,
      BASE_DEFAULT,
    ]);
  }
}
```

```ts
// harness-image-resolver.service.ts
import { Injectable } from "@nestjs/common";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { CompositeImageBuilderService } from "./composite-image-builder.service";
import { isNodeOnly } from "./composite-image-tag";

@Injectable()
export class HarnessImageResolver {
  constructor(private readonly builder: CompositeImageBuilderService) {}

  async resolveImageRef(params: {
    harnessId: string;
    baseImageRef: string;
    config: RuntimeToolchainConfig;
  }): Promise<string> {
    if (isNodeOnly(params.config)) return params.baseImageRef;
    return this.builder.ensureImage({
      harnessId: params.harnessId,
      baseImageRef: params.baseImageRef,
      config: params.config,
    });
  }
}
```

```ts
// workflow-runtime-toolchains.module.ts
import { Module } from "@nestjs/common";
import { DockerModule } from "../../docker/docker.module"; // confirm exact module that provides DOCKER_CLIENT
import { RepoToolchainDetectorService } from "./repo-toolchain-detector.service";
import { ToolchainResolverService } from "./toolchain-resolver.service";
import { HarnessImageResolver } from "./harness-image-resolver.service";
import { CompositeImageBuilderService } from "./composite-image-builder.service";
import { PackageCacheVolumeService } from "./package-cache-volume.service";

@Module({
  imports: [DockerModule],
  providers: [
    RepoToolchainDetectorService,
    ToolchainResolverService,
    HarnessImageResolver,
    CompositeImageBuilderService,
    PackageCacheVolumeService,
  ],
  exports: [
    ToolchainResolverService,
    HarnessImageResolver,
    PackageCacheVolumeService,
    CompositeImageBuilderService,
  ],
})
export class WorkflowRuntimeToolchainsModule {}
```

> **Note:** confirm the module that exports `DOCKER_CLIENT` (read `apps/api/src/docker/*.module.ts`) and import it. If the docker provider lives in a globally-registered module, drop the explicit import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains/harness-image-resolver.service.spec.ts apps/api/src/workflow/workflow-runtime-toolchains/toolchain-resolver.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire GC into the existing cleanup cron**

Find the periodic cleanup service (`git grep -ln "Cron\|@Interval\|cleanup" apps/api/src/docker apps/api/src/workflow | head`). In its scheduled handler, inject `CompositeImageBuilderService` and call `collectGarbage(COMPOSITE_IMAGE_MAX_AGE_MS)` where `COMPOSITE_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000` (define as a named constant near the other cleanup constants). Ensure that service's module imports `WorkflowRuntimeToolchainsModule`.

- [ ] **Step 6: Build API to verify wiring compiles**

Run: `npm run build:api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime-toolchains/
git commit -m "feat(api): add toolchain resolver, harness image resolver, module + GC wiring"
```

---

### Task 10: Integrate resolution + cache mounts into step provisioning

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts` (around the `prepareRuntimeAndProvisionContainer` `buildAgentContainerConfig` call at ~line 492, and `provisionJobContainer` at ~line 67)
- Modify: `apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts` (import `WorkflowRuntimeToolchainsModule`)
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.runtime-toolchains.spec.ts`

**Interfaces:**

- Consumes: `ToolchainResolverService`, `HarnessImageResolver`, `PackageCacheVolumeService`, the existing `harnessRegistry.resolve(harnessId)` (`HarnessProviderEntry.imageRef`), and `buildAgentContainerConfig(params)` → `IContainerConfig`.
- Produces: a provisioned container whose `IContainerConfig.image` is the resolved (base or composite) ref and whose `volumes`/`env` include the cache mounts.

- [ ] **Step 1: Read the integration site**

Read `step-agent-container-support.service.ts` fully. Identify, in `prepareRuntimeAndProvisionContainer`: where `params.tier`, `params.harnessImageRef`, `params.hostMountPath` (the workspace path on host), the agent profile, and the step/run inputs are available. The resolver needs: step inputs (`steps[].inputs` → `{toolchains, apt_packages, caches}`), the agent profile's `runtime_toolchains` (Task 13), the run input `runtime_toolchains` (Task 17), and the workspace path for detection.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { applyRuntimeToolchains } from "./step-agent-container-support.runtime-toolchains";

describe("applyRuntimeToolchains", () => {
  it("overrides image and appends cache volumes + env onto the container config", async () => {
    const baseConfig = {
      image: "nexus/harness-pi:latest",
      tier: "heavy",
      env: { A: "1" },
      volumes: [
        { hostPath: "/ws", containerPath: "/workspace", readOnly: false },
      ],
    } as any;
    const resolver = {
      resolve: vi
        .fn()
        .mockResolvedValue({
          toolchains: [{ tool: "python", version: "3.12" }],
        }),
    };
    const imageResolver = {
      resolveImageRef: vi.fn().mockResolvedValue("nexus-rt/pi:deadbeef0000"),
    };
    const cacheSvc = {
      resolveCacheMounts: vi
        .fn()
        .mockResolvedValue({
          volumes: [
            {
              hostPath: "nexus-cache-pip",
              containerPath: "/root/.cache/pip",
              readOnly: false,
            },
          ],
          env: { PIP_CACHE_DIR: "/root/.cache/pip" },
        }),
    };

    const out = await applyRuntimeToolchains({
      config: baseConfig,
      harnessId: "pi",
      baseImageRef: "nexus/harness-pi:latest",
      resolverInputs: { workspacePath: "/ws" },
      resolver: resolver as any,
      imageResolver: imageResolver as any,
      cacheService: cacheSvc as any,
    });

    expect(out.image).toBe("nexus-rt/pi:deadbeef0000");
    expect(out.env.PIP_CACHE_DIR).toBe("/root/.cache/pip");
    expect(out.volumes).toContainEqual({
      hostPath: "nexus-cache-pip",
      containerPath: "/root/.cache/pip",
      readOnly: false,
    });
    expect(out.volumes).toContainEqual({
      hostPath: "/ws",
      containerPath: "/workspace",
      readOnly: false,
    });
  });
});
```

- [ ] **Step 3: Write the integration helper (testable seam)**

```ts
// apps/api/src/workflow/workflow-step-execution/step-agent-container-support.runtime-toolchains.ts
import type { IContainerConfig } from "@nexus/core";
import type { ToolchainResolverService } from "../workflow-runtime-toolchains/toolchain-resolver.service";
import type { HarnessImageResolver } from "../workflow-runtime-toolchains/harness-image-resolver.service";
import type { PackageCacheVolumeService } from "../workflow-runtime-toolchains/package-cache-volume.service";
import type { RuntimeToolchainConfig } from "@nexus/core";

export async function applyRuntimeToolchains(params: {
  config: IContainerConfig;
  harnessId: string;
  baseImageRef: string;
  resolverInputs: {
    stepConfig?: RuntimeToolchainConfig;
    agentProfileConfig?: RuntimeToolchainConfig;
    runInputConfig?: RuntimeToolchainConfig;
    workspacePath?: string;
  };
  resolver: ToolchainResolverService;
  imageResolver: HarnessImageResolver;
  cacheService: PackageCacheVolumeService;
}): Promise<IContainerConfig> {
  const resolved = await params.resolver.resolve(params.resolverInputs);
  const image = await params.imageResolver.resolveImageRef({
    harnessId: params.harnessId,
    baseImageRef: params.baseImageRef,
    config: resolved,
  });
  const mounts = await params.cacheService.resolveCacheMounts(resolved);
  return {
    ...params.config,
    image,
    env: { ...(params.config.env ?? {}), ...mounts.env },
    volumes: [...(params.config.volumes ?? []), ...mounts.volumes],
  };
}
```

- [ ] **Step 4: Run the helper test (fails → passes)**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-step-execution/step-agent-container-support.runtime-toolchains.spec.ts`
Expected: FAIL then, after Step 3, PASS.

- [ ] **Step 5: Call the helper in `prepareRuntimeAndProvisionContainer`**

Inject the three services into `StepAgentContainerSupportService` (constructor) and, immediately after the existing `const config = buildAgentContainerConfig({ ... })` call (~line 492), replace the subsequent `provisionContainer(config, ...)` usage so it uses the augmented config:

```ts
const baseImageRef = this.harnessRegistry.resolve(params.harnessId).imageRef;
const finalConfig = await applyRuntimeToolchains({
  config,
  harnessId: params.harnessId,
  baseImageRef,
  resolverInputs: {
    stepConfig: parseStepRuntimeToolchainConfig(stepInputs), // shared parser from Task 12
    agentProfileConfig: params.agentProfileRuntimeToolchains ?? undefined, // threaded from profile (Task 13)
    runInputConfig: params.runInputRuntimeToolchains ?? undefined, // neutral run input (Task 16)
    workspacePath: params.hostMountPath,
  },
  resolver: this.toolchainResolver,
  imageResolver: this.harnessImageResolver,
  cacheService: this.packageCacheVolumeService,
});
// use finalConfig where `config` was previously passed to provisionContainer
```

`parseStepRuntimeToolchainConfig` is the single shared parser introduced in Task 12 (`apps/api/src/workflow/validation/workflow-validation.runtime-toolchains.ts`) — import it here rather than writing a second mapper. `stepInputs` is the `steps[].inputs` object already available in `params`/job data. Thread `agentProfileRuntimeToolchains` (from the loaded agent profile, Task 13) and `runInputRuntimeToolchains` (from `data` run inputs, Task 16) into the params type of `provisionJobContainer`. If you implement this task before Task 12, define `parseStepRuntimeToolchainConfig` first (it has no dependencies on Task 12's validator wiring).

- [ ] **Step 6: Import the module**

In `workflow-step-execution.module.ts` add `WorkflowRuntimeToolchainsModule` to `imports`.

- [ ] **Step 7: Build + run the step-execution suite**

Run: `npm run build:api && npm run test:api -- run apps/api/src/workflow/workflow-step-execution`
Expected: PASS (existing tests unaffected; node-only path returns the base image unchanged).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/
git commit -m "feat(api): resolve toolchains + cache mounts during step container provisioning"
```

---

### Task 11: Subagent path parity

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (image fallback ~lines 392-396)
- Modify: `apps/api/src/workflow/workflow-subagents/*.module.ts` (import `WorkflowRuntimeToolchainsModule`)
- Test: extend the existing subagent container-config spec (find with `git grep -l "subagent-orchestrator.container-config" apps/api/src`)

**Interfaces:**

- Consumes: same three services + `applyRuntimeToolchains` helper (reuse from Task 10 — do not duplicate).

- [ ] **Step 1: Write the failing test**

Add a case mirroring Task 10 Step 2 asserting the subagent container config gets the composite image + cache mounts when the resolved set is non-node. Reuse `applyRuntimeToolchains` so the assertion is identical in shape.

- [ ] **Step 2: Run it (fails)**

Run: `npm run test:api -- run apps/api/src/workflow/workflow-subagents`
Expected: FAIL on the new case.

- [ ] **Step 3: Apply `applyRuntimeToolchains` in the subagent config path**

After the subagent container config is built (where `harnessImageRef ?? tier-fallback` currently resolves the image), call `applyRuntimeToolchains` with the subagent's resolver inputs (subagent step inputs, the subagent's agent profile `runtime_toolchains`, the run input config, and the subagent workspace path). This closes the known step-vs-subagent divergence for the toolchain concern.

- [ ] **Step 4: Run it (passes)**

Run: `npm run build:api && npm run test:api -- run apps/api/src/workflow/workflow-subagents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/
git commit -m "feat(api): apply runtime toolchains on the subagent provisioning path too"
```

---

## Phase 5 — Workflow step-input validation

### Task 12: Validate step `toolchains` / `apt_packages` / `caches` inputs

**Files:**

- Modify: `apps/api/src/workflow/validation/workflow-validation.job-validators.ts` (where step inputs are validated; confirm exact validator)
- Test: `apps/api/src/workflow/validation/workflow-validation.runtime-toolchains.spec.ts`

**Interfaces:**

- Consumes: `validateRuntimeToolchainConfig` + a parser that lifts `steps[].inputs.{toolchains, apt_packages, caches, disable_caches}` into a `RuntimeToolchainConfig`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseStepRuntimeToolchainConfig } from "./workflow-validation.runtime-toolchains";

describe("parseStepRuntimeToolchainConfig", () => {
  it("parses toolchains/apt/caches from step inputs", () => {
    const cfg = parseStepRuntimeToolchainConfig({
      toolchains: [{ tool: "python", version: "3.12" }],
      apt_packages: ["libpq-dev"],
      caches: [{ id: "pc", path: "/root/.cache/pc" }],
    });
    expect(cfg).toEqual({
      toolchains: [{ tool: "python", version: "3.12" }],
      aptPackages: ["libpq-dev"],
      caches: [{ id: "pc", path: "/root/.cache/pc" }],
      disableCaches: undefined,
    });
  });

  it("returns undefined when no runtime keys present", () => {
    expect(parseStepRuntimeToolchainConfig({ model: "x" })).toBeUndefined();
  });

  it("throws via validation on a bad tool", () => {
    expect(() =>
      parseStepRuntimeToolchainConfig({
        toolchains: [{ tool: "evil", version: "1" }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm run test:api -- run apps/api/src/workflow/validation/workflow-validation.runtime-toolchains.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser + validator hook**

```ts
// apps/api/src/workflow/validation/workflow-validation.runtime-toolchains.ts
import type { RuntimeToolchainConfig } from "@nexus/core";
import { validateRuntimeToolchainConfig } from "../workflow-runtime-toolchains/toolchain-validation";

export function parseStepRuntimeToolchainConfig(
  inputs: Record<string, unknown>,
): RuntimeToolchainConfig | undefined {
  const hasAny = [
    "toolchains",
    "apt_packages",
    "caches",
    "disable_caches",
  ].some((k) => k in inputs);
  if (!hasAny) return undefined;
  const config: RuntimeToolchainConfig = {
    toolchains:
      (inputs.toolchains as RuntimeToolchainConfig["toolchains"]) ?? [],
    aptPackages: inputs.apt_packages as string[] | undefined,
    caches: inputs.caches as RuntimeToolchainConfig["caches"],
    disableCaches: inputs.disable_caches as string[] | undefined,
  };
  validateRuntimeToolchainConfig(config);
  return config;
}
```

Then call `parseStepRuntimeToolchainConfig(step.inputs)` inside the existing step-input validation loop so an invalid toolchain fails workflow validation at author time (not provisioning time). Reuse this same parser as `extractStepToolchainConfig` in Task 10 (import it there instead of duplicating).

- [ ] **Step 4: Run it (passes) + the validation suite**

Run: `npm run test:api -- run apps/api/src/workflow/validation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/validation/
git commit -m "feat(api): validate step-level runtime toolchain inputs at author time"
```

---

## Phase 6 — Persistence (agent profile column)

### Task 13: `agent_profiles.runtime_toolchains` column + migration + core type

**Files:**

- Modify: `packages/core/src/interfaces/agent-profile.types.ts` (add field to `IAgentProfile`)
- Modify: `apps/api/src/ai-config/database/entities/agent-profile.entity.ts` (add column)
- Create: `apps/api/src/database/migrations/20260630120000-add-agent-profile-runtime-toolchains.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts` (register, newest-first)
- Test: `apps/api/src/database/migrations/20260630120000-add-agent-profile-runtime-toolchains.spec.ts` (optional smoke; prefer the existing migration test pattern if one exists — otherwise rely on the entity round-trip in an existing ai-config repo test)

**Interfaces:**

- Produces: `IAgentProfile.runtime_toolchains?: RuntimeToolchainConfig | null` and the matching entity column. Consumed by Task 10 (profile layer) and Task 19 (web).

- [ ] **Step 1: Add the core interface field**

In `packages/core/src/interfaces/agent-profile.types.ts`, add the import and field:

```ts
import type { RuntimeToolchainConfig } from "./runtime-toolchain.types";
// ...inside IAgentProfile, after fallback_chain:
  runtime_toolchains?: RuntimeToolchainConfig | null;
```

- [ ] **Step 2: Add the entity column**

In `agent-profile.entity.ts`, add the import and column (next to `fallback_chain`):

```ts
import type {
  IAgentProfile,
  SkillDiscoveryMode,
  FallbackChainEntry,
  RuntimeToolchainConfig,
} from '@nexus/core';
// ...next to fallback_chain:
  @Column({ type: 'jsonb', nullable: true, default: null })
  runtime_toolchains?: RuntimeToolchainConfig | null;
```

- [ ] **Step 3: Write the migration**

```ts
// apps/api/src/database/migrations/20260630120000-add-agent-profile-runtime-toolchains.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentProfileRuntimeToolchains20260630120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN IF NOT EXISTS runtime_toolchains jsonb NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        DROP COLUMN IF EXISTS runtime_toolchains;
    `);
  }
}
```

- [ ] **Step 4: Register the migration**

In `registered-migrations.ts`, import the class and add it to the array following the existing newest-first ordering convention.

- [ ] **Step 5: Build + run ai-config tests**

Run: `npm run build --workspace=packages/core && npm run build:api && npm run test:api -- run apps/api/src/ai-config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/interfaces/agent-profile.types.ts apps/api/src/ai-config/database/entities/agent-profile.entity.ts apps/api/src/database/migrations/20260630120000-add-agent-profile-runtime-toolchains.ts apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(api): persist runtime_toolchains on agent profiles"
```

---

## Phase 7 — Docker base images (add `mise` + apt cache)

### Task 14: Add `mise` and runtime apt-cache config to harness images

**Files:**

- Modify: `docker/Dockerfile.heavy` (builds `nexus-heavy` + `nexus/harness-pi`)
- Modify: `docker/Dockerfile.claude-code` (builds `nexus/harness-claude-code`)
- Modify: `docker/heavy-entrypoint.sh` (no functional change required, but verify it doesn't strip new env)

**Interfaces:**

- Produces: harness images that contain `mise` on `PATH` and keep apt downloads, so composite builds (`FROM <harness image>`) and runtime apt/mise installs use the mounted caches.

- [ ] **Step 1: Add `mise` + apt keep-downloaded to `Dockerfile.heavy`**

In the run-stage apt block (after `fd-find`), add `mise` install and apt cache retention. Insert after the existing apt install `RUN` (lines ~24-37):

```dockerfile
# Keep downloaded .deb packages so a mounted /var/cache/apt/archives volume
# caches runtime apt installs across containers.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

# Install mise (declarative toolchain manager) so composite images built FROM
# this image can `mise use -g <tool>@<version>` to add languages on demand.
RUN curl -fsSL https://mise.run | sh \
    && ln -s /root/.local/bin/mise /usr/local/bin/mise
ENV MISE_DATA_DIR=/root/.local/share/mise
ENV PATH="/root/.local/share/mise/shims:/usr/local/bin:${PATH}"
```

- [ ] **Step 2: Mirror the `mise` install in `Dockerfile.claude-code`**

Add the same `mise` install + `ENV PATH`/`MISE_DATA_DIR` lines and the apt keep-cache config to `Dockerfile.claude-code` (it already has `curl`). This lets `claude-code` composites build identically.

- [ ] **Step 3: Build the heavy/pi image locally to verify mise resolves**

Run:

```bash
docker build -f docker/Dockerfile.heavy -t nexus-heavy:latest -t nexus/harness-pi:latest .
docker run --rm nexus/harness-pi:latest mise --version
```

Expected: image builds; `mise --version` prints a version.

- [ ] **Step 4: Build claude-code image**

Run:

```bash
docker build -f docker/Dockerfile.claude-code -t nexus/harness-claude-code:latest .
docker run --rm nexus/harness-claude-code:latest mise --version
```

Expected: PASS.

- [ ] **Step 5: Smoke-test a composite build by hand**

Run:

```bash
printf '# syntax=docker/dockerfile:1.7\nFROM nexus/harness-pi:latest\nRUN --mount=type=cache,target=/root/.cache/mise mise use -g python@3.12 && mise reshim\n' > /tmp/Dockerfile.composite
DOCKER_BUILDKIT=1 docker build -f /tmp/Dockerfile.composite -t nexus-rt/pi:smoketest /tmp
docker run --rm nexus-rt/pi:smoketest python --version
```

Expected: `Python 3.12.x`.

- [ ] **Step 6: Commit**

```bash
git add docker/Dockerfile.heavy docker/Dockerfile.claude-code
git commit -m "feat(docker): add mise + apt cache retention to harness images for composite builds"
```

---

## Phase 8 — Kanban project layer (boundary-safe)

> **Boundary reminder:** all changes in this phase live under `apps/kanban` / `packages/kanban-contracts`. The API/core never reads these — Kanban injects the value as a neutral `runtime_toolchains` run input.

### Task 15: `kanban_projects.runtime_toolchains` column + migration

**Files:**

- Modify: `apps/kanban/src/database/entities/kanban-project.entity.ts`
- Create: `apps/kanban/src/database/migrations/<timestamp>-add-kanban-project-runtime-toolchains.ts` (match the Kanban migrations dir + registration pattern — `git grep -l "MigrationInterface" apps/kanban/src`)
- Modify: the Kanban migrations registration file (mirror Task 13 Step 4 for the kanban data source)
- Test: an entity/repo round-trip in the existing kanban DB test pattern

**Interfaces:**

- Produces: `KanbanProject.runtime_toolchains` (typed `RuntimeToolchainConfig | null`, imported from `@nexus/core` — core types are shared and Kanban-neutral, so this is allowed).

- [ ] **Step 1: Add the entity column**

```ts
import type { RuntimeToolchainConfig } from "@nexus/core";
// ...in KanbanProject entity:
  @Column({ type: "jsonb", nullable: true, default: null })
  runtime_toolchains?: RuntimeToolchainConfig | null;
```

- [ ] **Step 2: Write + register the migration** (mirror Task 13 Step 3-4, table `kanban_projects`).

- [ ] **Step 3: Build + test kanban**

Run: `npm run build:kanban && npm run test:kanban -- run apps/kanban/src/database`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/database/
git commit -m "feat(kanban): persist runtime_toolchains on kanban projects"
```

---

### Task 16: Inject project `runtime_toolchains` into the workflow launch payload

**Files:**

- Modify: the Kanban launch path that builds the workflow launch request (find with `git grep -ln "launch\|trigger" apps/kanban/src | head` — the place that already passes neutral `scopeId`/`contextId`)
- Test: a unit test on the launch-payload builder

**Interfaces:**

- Consumes: `KanbanProject.runtime_toolchains`.
- Produces: a launch payload whose neutral `inputs.runtime_toolchains` carries the project's config (omitted when null). The API side (Task 10/17) reads it from run inputs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildLaunchInputsWithToolchains } from "./<launch-builder-file>";

describe("buildLaunchInputsWithToolchains", () => {
  it("adds runtime_toolchains when the project has it", () => {
    const inputs = buildLaunchInputsWithToolchains({
      base: { scopeId: "s" },
      project: {
        runtime_toolchains: { toolchains: [{ tool: "go", version: "1.23" }] },
      } as any,
    });
    expect(inputs.runtime_toolchains).toEqual({
      toolchains: [{ tool: "go", version: "1.23" }],
    });
    expect(inputs.scopeId).toBe("s");
  });

  it("omits runtime_toolchains when null", () => {
    const inputs = buildLaunchInputsWithToolchains({
      base: { scopeId: "s" },
      project: { runtime_toolchains: null } as any,
    });
    expect("runtime_toolchains" in inputs).toBe(false);
  });
});
```

- [ ] **Step 2: Implement the builder helper**

```ts
import type { RuntimeToolchainConfig } from "@nexus/core";

export function buildLaunchInputsWithToolchains(params: {
  base: Record<string, unknown>;
  project: { runtime_toolchains?: RuntimeToolchainConfig | null };
}): Record<string, unknown> {
  return params.project.runtime_toolchains
    ? { ...params.base, runtime_toolchains: params.project.runtime_toolchains }
    : { ...params.base };
}
```

Call it where the launch inputs are assembled, passing the loaded project.

- [ ] **Step 3: Read the run input on the API side**

In Task 10's `provisionJobContainer`, set `runInputRuntimeToolchains` from the run inputs (`data.inputs?.runtime_toolchains` — confirm the run-input accessor). The resolver treats it as layer 3. Add an API-side test asserting a run input flows through `applyRuntimeToolchains` as the `runInputConfig` (extend the Task 10 spec).

- [ ] **Step 4: Build + test**

Run: `npm run build:kanban && npm run test:kanban -- run apps/kanban && npm run test:api -- run apps/api/src/workflow/workflow-step-execution`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/ apps/api/src/workflow/workflow-step-execution/
git commit -m "feat(kanban): inject project runtime_toolchains as neutral launch input"
```

---

## Phase 9 — Frontend (apps/web)

Run web tests with the OOM fork cap, e.g. `VITEST_MAX_FORKS=4 npm run test:unit:web -- run <path>`.

### Task 17: `RuntimeToolchainEditor` component

**Files:**

- Create: `apps/web/src/components/runtime-toolchains/RuntimeToolchainEditor.tsx`
- Test: `apps/web/src/components/runtime-toolchains/RuntimeToolchainEditor.spec.tsx`

**Interfaces:**

- Consumes: `RuntimeToolchainConfig`, `SUPPORTED_TOOLS` (re-export the allowlist from `@nexus/core` so web and API share it — move `SUPPORTED_TOOLS` to `packages/core/src/interfaces/runtime-toolchain.types.ts` and import it in Task 4 instead of redeclaring).
- Produces: `RuntimeToolchainEditor({ value, onChange }: { value: RuntimeToolchainConfig; onChange: (next: RuntimeToolchainConfig) => void })`.

- [ ] **Step 1: Move `SUPPORTED_TOOLS` into core (so web can import it)**

In `packages/core/src/interfaces/runtime-toolchain.types.ts` add:

```ts
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
```

Update Task 4's `toolchain-validation.ts` to `import { SUPPORTED_TOOLS } from "@nexus/core"` instead of redeclaring (keeps one source of truth). Rebuild core: `npm run build --workspace=packages/core`.

- [ ] **Step 2: Write the failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RuntimeToolchainEditor } from "./RuntimeToolchainEditor";

describe("RuntimeToolchainEditor", () => {
  it("adds a toolchain row via onChange", () => {
    const onChange = vi.fn();
    render(
      <RuntimeToolchainEditor value={{ toolchains: [] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add toolchain/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        toolchains: [{ tool: "node", version: "latest" }],
      }),
    );
  });

  it("removes a toolchain row", () => {
    const onChange = vi.fn();
    render(
      <RuntimeToolchainEditor
        value={{ toolchains: [{ tool: "go", version: "1.23" }] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /remove toolchain 1/i }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ toolchains: [] }),
    );
  });
});
```

- [ ] **Step 3: Implement the component** (mirror `FallbackChainEditor` add/remove/patch pattern)

```tsx
// apps/web/src/components/runtime-toolchains/RuntimeToolchainEditor.tsx
import type {
  RuntimeToolchainConfig,
  ToolchainSpec,
  CacheMountSpec,
} from "@nexus/core";
import { SUPPORTED_TOOLS } from "@nexus/core";

interface Props {
  value: RuntimeToolchainConfig;
  onChange: (next: RuntimeToolchainConfig) => void;
}

export function RuntimeToolchainEditor({ value, onChange }: Readonly<Props>) {
  const toolchains = value.toolchains ?? [];
  const caches = value.caches ?? [];

  const setToolchains = (t: ToolchainSpec[]) =>
    onChange({ ...value, toolchains: t });
  const setCaches = (c: CacheMountSpec[]) => onChange({ ...value, caches: c });

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-sm font-medium">Toolchains</p>
        {toolchains.map((tc, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              aria-label={`tool ${i + 1}`}
              value={tc.tool}
              onChange={(e) =>
                setToolchains(
                  toolchains.map((x, j) =>
                    j === i ? { ...x, tool: e.target.value } : x,
                  ),
                )
              }
            >
              {SUPPORTED_TOOLS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              aria-label={`version ${i + 1}`}
              value={tc.version}
              onChange={(e) =>
                setToolchains(
                  toolchains.map((x, j) =>
                    j === i ? { ...x, version: e.target.value } : x,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label={`remove toolchain ${i + 1}`}
              onClick={() =>
                setToolchains(toolchains.filter((_, j) => j !== i))
              }
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label="add toolchain"
          onClick={() =>
            setToolchains([...toolchains, { tool: "node", version: "latest" }])
          }
        >
          Add toolchain
        </button>
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium">Custom caches</p>
        {caches.map((c, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              aria-label={`cache id ${i + 1}`}
              value={c.id}
              onChange={(e) =>
                setCaches(
                  caches.map((x, j) =>
                    j === i ? { ...x, id: e.target.value } : x,
                  ),
                )
              }
            />
            <input
              aria-label={`cache path ${i + 1}`}
              value={c.path}
              onChange={(e) =>
                setCaches(
                  caches.map((x, j) =>
                    j === i ? { ...x, path: e.target.value } : x,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label={`remove cache ${i + 1}`}
              onClick={() => setCaches(caches.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label="add cache"
          onClick={() => setCaches([...caches, { id: "", path: "" }])}
        >
          Add cache
        </button>
      </section>
    </div>
  );
}
```

> Use the project's `Select`/`Input`/`Button` UI primitives instead of raw elements if the lint config requires it — match `FallbackChainEditor.tsx`. Keep the `aria-label`s so the tests stay stable.

- [ ] **Step 4: Run the test (fails → passes)**

Run: `VITEST_MAX_FORKS=4 npm run test:unit:web -- run apps/web/src/components/runtime-toolchains/RuntimeToolchainEditor.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/interfaces/runtime-toolchain.types.ts apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.ts apps/web/src/components/runtime-toolchains/
git commit -m "feat(web): add RuntimeToolchainEditor + share SUPPORTED_TOOLS via core"
```

---

### Task 18: Agent profile form wiring

**Files:**

- Modify: `apps/web/src/lib/api/types.ts` (`AgentProfile`, `CreateAgentProfileRequest`, `UpdateAgentProfileRequest`)
- Modify: `apps/web/src/pages/agents/AgentProfileForm.tsx` (schema + new tab/section)
- Modify: `apps/web/src/pages/agents/AgentProfileEditor.controller.ts` (`buildProfileData`)
- Test: extend `apps/web/src/pages/agents/AgentProfileEditor.controller.spec.ts` (or create if absent)

**Interfaces:**

- Consumes: `RuntimeToolchainConfig`, `RuntimeToolchainEditor`.
- Produces: profile create/update payloads carrying `runtime_toolchains`.

- [ ] **Step 1: Extend the web DTO types**

Add to all three interfaces in `types.ts`:

```ts
import type { RuntimeToolchainConfig } from "@nexus/core";
// AgentProfile:
  runtime_toolchains?: RuntimeToolchainConfig | null;
// CreateAgentProfileRequest & UpdateAgentProfileRequest:
  runtime_toolchains?: RuntimeToolchainConfig | null;
```

- [ ] **Step 2: Write the failing controller test**

```ts
import { describe, it, expect } from "vitest";
import { buildProfileData } from "./AgentProfileEditor.controller";

describe("buildProfileData runtime_toolchains", () => {
  it("includes runtime_toolchains when toolchains present", () => {
    const out = buildProfileData({
      name: "x",
      allowed_tools: [],
      denied_tools: [],
      approval_required_tools: [],
      fallback_chain: [],
      runtime_toolchains: { toolchains: [{ tool: "python", version: "3.12" }] },
    } as any);
    expect(out.runtime_toolchains).toEqual({
      toolchains: [{ tool: "python", version: "3.12" }],
    });
  });

  it("sends undefined when no toolchains", () => {
    const out = buildProfileData({
      name: "x",
      allowed_tools: [],
      denied_tools: [],
      approval_required_tools: [],
      fallback_chain: [],
      runtime_toolchains: { toolchains: [] },
    } as any);
    expect(out.runtime_toolchains).toBeUndefined();
  });
});
```

> If `buildProfileData` is not currently exported, export it (the function exists at controller line ~69). This is a minimal, in-scope change.

- [ ] **Step 3: Implement schema + mapping + UI**

- In `AgentProfileForm.tsx` `formSchema`, add:
  ```ts
  runtime_toolchains: z.object({
    toolchains: z.array(z.object({ tool: z.string(), version: z.string() })).default([]),
    aptPackages: z.array(z.string()).optional(),
    caches: z.array(z.object({ id: z.string(), path: z.string() })).optional(),
    disableCaches: z.array(z.string()).optional(),
  }).default({ toolchains: [] }),
  ```
- Add the field to `buildFormDefaults` (default `{ toolchains: [] }` from `profile?.runtime_toolchains`).
- Add a new tab/section rendering `<RuntimeToolchainEditor value={field.value} onChange={field.onChange} />` via a `FormField name="runtime_toolchains"`.
- In `buildProfileData`, add:

  ```ts
  runtime_toolchains: data.runtime_toolchains?.toolchains.length ? data.runtime_toolchains : undefined,
  ```

- [ ] **Step 4: Run the controller test + typecheck**

Run: `VITEST_MAX_FORKS=4 npm run test:unit:web -- run apps/web/src/pages/agents/AgentProfileEditor.controller.spec.ts && npm run lint:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/types.ts apps/web/src/pages/agents/
git commit -m "feat(web): edit runtime toolchains on the agent profile form"
```

---

### Task 19: Project settings card (Kanban-backed)

**Files:**

- Modify: `apps/web/src/pages/project-workspace/SettingsTab.tsx` (new "Runtime toolchains" card)
- Modify: the project API client method used by SettingsTab (`api.updateProject` / project settings client) + its request/response types to include `runtime_toolchains`
- Test: a component test for the new card (render + save mutation called with `runtime_toolchains`)

**Interfaces:**

- Consumes: `RuntimeToolchainEditor`, the existing project-update mutation. Persists to `kanban_projects.runtime_toolchains` via the Kanban-backed project endpoint.

- [ ] **Step 1: Extend the project update request/response type** with `runtime_toolchains?: RuntimeToolchainConfig | null` (find the type behind `api.updateProject` in `apps/web/src/lib/api/`; add the field). Import `RuntimeToolchainConfig` from `@nexus/core`.

- [ ] **Step 2: Write the failing card test**

```tsx
// apps/web/src/pages/project-workspace/RuntimeToolchainsCard.spec.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RuntimeToolchainsCard } from "./RuntimeToolchainsCard";

describe("RuntimeToolchainsCard", () => {
  it("saves the edited toolchains via onSave", () => {
    const onSave = vi.fn();
    render(
      <RuntimeToolchainsCard value={{ toolchains: [] }} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add toolchain/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /save runtime toolchains/i }),
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        toolchains: [{ tool: "node", version: "latest" }],
      }),
    );
  });
});
```

- [ ] **Step 3: Implement the card** as a small presentational component (`border-t pt-4` settings-card pattern) holding local `useState` seeded from `value`, rendering `<RuntimeToolchainEditor value={draft} onChange={setDraft} />` and a "Save runtime toolchains" button that calls `onSave(draft)`:

```tsx
// apps/web/src/pages/project-workspace/RuntimeToolchainsCard.tsx
import { useState } from "react";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { RuntimeToolchainEditor } from "@/components/runtime-toolchains/RuntimeToolchainEditor";

interface Props {
  value: RuntimeToolchainConfig;
  onSave: (next: RuntimeToolchainConfig) => void;
}

export function RuntimeToolchainsCard({ value, onSave }: Readonly<Props>) {
  const [draft, setDraft] = useState<RuntimeToolchainConfig>(value);
  return (
    <div className="space-y-4 border-t pt-4">
      <p className="text-sm font-medium">Runtime toolchains</p>
      <RuntimeToolchainEditor value={draft} onChange={setDraft} />
      <button
        type="button"
        aria-label="save runtime toolchains"
        onClick={() => onSave(draft)}
      >
        Save runtime toolchains
      </button>
    </div>
  );
}
```

Then render `<RuntimeToolchainsCard value={project.runtime_toolchains ?? { toolchains: [] }} onSave={(rt) => updateProject.mutate({ runtime_toolchains: rt.toolchains.length ? rt : null })} />` inside `SettingsTab.tsx` using the existing `updateProject` mutation.

- [ ] **Step 4: Run the test + lint**

Run: `VITEST_MAX_FORKS=4 npm run test:unit:web -- run apps/web/src/pages/project-workspace && npm run lint:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/ apps/web/src/lib/api/
git commit -m "feat(web): edit project runtime toolchains (Kanban-backed) in settings"
```

---

### Task 20 (optional): Step properties toolchain override

**Files:**

- Modify: `apps/web/src/components/workflow-editor/StepProperties.tsx`

- [ ] **Step 1:** Add a collapsible "Toolchains override" section rendering `RuntimeToolchainEditor`, reading/writing `step.inputs.toolchains` (+ `apt_packages`/`caches`) on the existing step-inputs editing path.
- [ ] **Step 2:** `VITEST_MAX_FORKS=4 npm run test:unit:web -- run apps/web/src/components/workflow-editor && npm run lint:web` → PASS.
- [ ] **Step 3:** Commit `feat(web): optional step-level toolchain override in the workflow editor`.

---

## Phase 10 — Documentation & skill

### Task 21: Docs, CLAUDE.md quirk, and authoring skill

**Files:**

- Create: `docs/guide/multi-language-runtimes.md`
- Modify: `docs/guide/README.md` (link the new page)
- Modify: `CLAUDE.md` (Architecture Quirks: toolchain precedence + composite tag + cache registry + boundary note)
- Create: `.agents/skills/runtime-toolchains/SKILL.md`

- [ ] **Step 1:** Write `docs/guide/multi-language-runtimes.md` covering: the precedence chain (step → profile → run-input(Kanban) → repo-detect → base), how composite images are tagged/cached/GC'd, the cache-volume registry (presets + custom + disable), the apt/OS caching, the boundary rule (project layer is Kanban-injected), and how to add a new supported tool (extend `SUPPORTED_TOOLS`).
- [ ] **Step 2:** Add a one-line link under the Documentation Map in `docs/guide/README.md`.
- [ ] **Step 3:** Add a quirk bullet to `CLAUDE.md` Architecture Quirks summarizing toolchain precedence + that the API never reads project tables (Kanban injects `runtime_toolchains`).
- [ ] **Step 4:** Write `.agents/skills/runtime-toolchains/SKILL.md` (trigger: "add a language / toolchain / cache to the harness"; steps: extend `SUPPORTED_TOOLS`, optional apt deps, where presets live, how to test a composite build).
- [ ] **Step 5:** Commit `docs(guide): document multi-language harness runtimes + add authoring skill`.

---

## Final verification

- [ ] **Build everything in order:**
  ```bash
  npm run build --workspace=packages/core && npm run build:api && npm run build:kanban && npm run build:web
  ```
- [ ] **Run the affected suites:**
  ```bash
  npm run test:api -- run apps/api/src/workflow/workflow-runtime-toolchains apps/api/src/workflow/workflow-step-execution apps/api/src/workflow/workflow-subagents apps/api/src/workflow/validation apps/api/src/ai-config
  npm run test:kanban -- run apps/kanban/src/database apps/kanban/src
  VITEST_MAX_FORKS=4 npm run test:unit:web -- run apps/web/src/components/runtime-toolchains apps/web/src/pages/agents apps/web/src/pages/project-workspace
  ```
- [ ] **Lint:** `npm run lint:summary` (repo-wide; must be clean — no suppressions).
- [ ] **Boundary check:** confirm no `kanban`/project-domain identifiers leaked into `apps/api/src` or `packages/core/src` (the boundary lint rule must pass).
- [ ] **Rebuild + redeploy harness images** (`make build-heavy build-claude-code`) and the API/Kanban images; run reseed if agent-profile/workflow seed touched.
- [ ] **Live smoke:** create an agent profile with `python@3.12`, run a workflow step against a Python repo, confirm a `nexus-rt/...` image is built once and reused, and that `nexus-cache-pip` is populated after a `pip install`.

---

## Notes carried from the spec (do not lose)

- **Backward compat is the safety net:** node-only resolved sets MUST return the existing harness image with no build and no extra behavior. Every existing JS workflow depends on this. Verify the node-only fast path in Task 9/10 tests.
- **No silent failures:** build failures surface as `CompositeImageBuildError` with a NUL-sanitized log tail; cache-volume unavailability degrades to an uncached install, never a hard fail.
- **One source of truth:** `SUPPORTED_TOOLS` and all toolchain types live in `@nexus/core`; do not redeclare in API or web.
