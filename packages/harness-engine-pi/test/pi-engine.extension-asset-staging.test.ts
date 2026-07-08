/**
 * PI engine — authored extension asset staging.
 *
 * Verifies that `createSession` stages `ts-module` extension assets as `.ts`
 * files in `ctx.extensionsPath` BEFORE the PI resource loader scans for
 * extensions, and that staged files are cleaned up on session dispose.
 *
 * Uses the same mock harness as `pi-engine.contributions.test.ts`: the
 * pi-coding-agent SDK is mocked at the module level; a real temp dir is used
 * for `extensionsPath` so file-system assertions are genuine.
 *
 * TDD: Red phase — written before `contribution-extension-staging.ts` exists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { computeAssetChecksum } from "@nexus/core";

/**
 * Build a ts-module extension asset with a canonical bundle + matching checksum.
 * The `bundle` field and `checksum` are derived from the provided `moduleSource`
 * so the engine-side re-verify guard passes.
 */
function makeValidTsExt(fields: {
  id: string;
  name: string;
  moduleSource: string;
  entry?: string;
}) {
  const entry = fields.entry ?? "src/index.ts";
  const bundle = JSON.stringify({
    runtime: "ts-module",
    entry,
    moduleSource: fields.moduleSource,
  });
  return {
    id: fields.id,
    name: fields.name,
    runtime: "ts-module" as const,
    entry,
    source: { kind: "authored" as const },
    checksum: computeAssetChecksum(bundle),
    bundle,
    moduleSource: fields.moduleSource,
  };
}

// ---------------------------------------------------------------------------
// SDK mock — mirrors pi-engine.contributions.test.ts
// ---------------------------------------------------------------------------

const mockCreateAgentSession = vi.fn();
const mockModelRegistryFind = vi.fn();
const mockSessionManagerCreate = vi.fn();
const mockAuthInstance = { setRuntimeApiKey: vi.fn() };

// Capture the DefaultResourceLoader ctor args so tests can inspect
// additionalExtensionPaths.
const mockResourceLoaderInstance = {
  reload: vi.fn().mockResolvedValue(undefined),
};
const mockDefaultResourceLoaderCtor = vi
  .fn()
  .mockImplementation(function DefaultResourceLoader() {
    return mockResourceLoaderInstance;
  });

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createCodingTools: vi.fn().mockReturnValue([]),
  createReadOnlyTools: vi.fn().mockReturnValue([]),
  AuthStorage: { inMemory: vi.fn().mockReturnValue(mockAuthInstance) },
  ModelRegistry: {
    inMemory: vi.fn().mockReturnValue({
      find: mockModelRegistryFind,
      getAll: vi.fn().mockReturnValue([]),
      registerProvider: vi.fn(),
    }),
  },
  SessionManager: {
    open: vi.fn(),
    create: mockSessionManagerCreate,
  },
  SettingsManager: { inMemory: vi.fn().mockReturnValue({}) },
  DefaultResourceLoader: mockDefaultResourceLoaderCtor,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RUNTIME_CONFIG = {
  harnessId: "pi" as const,
  model: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    auth: { type: "api_key" as const, apiKey: "test-key" },
  },
  prompt: {
    systemPrompt: "You are a helpful agent.",
    initialPrompt: "Go.",
  },
};

const EMPTY_CONTRIBUTIONS = {
  hooks: [],
  extensions: [],
  plugins: [],
  settings: {},
};

function makeCtx(extensionsPath: string, contributions: unknown) {
  return {
    governedTools: [] as [],
    toolCatalog: [] as [],
    checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath,
    sessionPath: path.join(extensionsPath, "session.jsonl"),
    contributions,
  };
}

// ---------------------------------------------------------------------------
// stageExtensionAssets — unit tests (pure function)
// ---------------------------------------------------------------------------

describe("stageExtensionAssets", () => {
  let stageDir: string;

  beforeEach(() => {
    stageDir = mkdtempSync(path.join(os.tmpdir(), "ext-staging-unit-"));
  });

  afterEach(() => {
    rmSync(stageDir, { recursive: true, force: true });
  });

  it("stages a ts-module extension as a .ts file with the authored module source", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    const moduleSource = `import type { PiExtension } from "@earendil-works/pi-coding-agent";
export default function myExtension(): PiExtension {
  return {};
}`;

    const extensions = [
      makeValidTsExt({ id: "ext-1", name: "my-extension", moduleSource }),
    ];

    const staged = stageExtensionAssets(stageDir, extensions);

    expect(staged).toHaveLength(1);
    const [stagedPath] = staged;
    expect(stagedPath).toBeDefined();
    expect(stagedPath).toMatch(/\.ts$/);
    expect(stagedPath).not.toMatch(/index\.ts$/);
    expect(existsSync(stagedPath)).toBe(true);
    expect(readFileSync(stagedPath, "utf-8")).toBe(moduleSource);
  });

  it("staged file contents are byte-identical to the authored source", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    const moduleSource = "export default function ext() { return {}; }";
    const extensions = [
      makeValidTsExt({
        id: "ext-bytes",
        name: "byte-check-ext",
        moduleSource,
        entry: "src/main.ts",
      }),
    ];

    const staged = stageExtensionAssets(stageDir, extensions);
    const [stagedPath] = staged;
    // Byte-identical: Buffer equality, not just string equality.
    const writtenBytes = readFileSync(stagedPath);
    const expectedBytes = Buffer.from(moduleSource, "utf-8");
    expect(writtenBytes).toEqual(expectedBytes);
  });

  it("returns an empty array when extensions list is empty (byte-identical, no files)", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    const staged = stageExtensionAssets(stageDir, []);

    expect(staged).toHaveLength(0);
    expect(readdirSync(stageDir).filter((f) => f.endsWith(".ts"))).toEqual([]);
  });

  it("drops an extension with missing moduleSource (no moduleSource field) and diagnoses it, never throws", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    // Extension missing bundle + checksum mismatch — dropped by re-verify guard.
    const extensions = [
      {
        id: "ext-missing-source",
        name: "broken-ext",
        runtime: "ts-module" as const,
        entry: "src/index.ts",
        source: { kind: "authored" as const },
        checksum:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        // No bundle, no moduleSource
      },
    ];

    // Must not throw.
    const staged = stageExtensionAssets(stageDir, extensions);
    // Dropped: no file staged.
    expect(staged).toHaveLength(0);
    expect(readdirSync(stageDir).filter((f) => f.endsWith(".ts"))).toEqual([]);
  });

  it("drops an extension with empty string moduleSource and diagnoses it, never throws", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    // Bundle has empty moduleSource — the re-verify passes (bundle matches checksum),
    // but the missing_source guard fires because moduleSource is "".
    const emptySource = "";
    const bundle = JSON.stringify({
      runtime: "ts-module",
      entry: "src/index.ts",
      moduleSource: emptySource,
    });
    const extensions = [
      {
        id: "ext-empty-source",
        name: "empty-ext",
        runtime: "ts-module" as const,
        entry: "src/index.ts",
        source: { kind: "authored" as const },
        checksum: computeAssetChecksum(bundle),
        bundle,
        moduleSource: emptySource,
      },
    ];

    const staged = stageExtensionAssets(stageDir, extensions);
    expect(staged).toHaveLength(0);
    expect(readdirSync(stageDir).filter((f) => f.endsWith(".ts"))).toEqual([]);
  });

  it("skips package-runtime extensions without crashing (not implemented this task)", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    // Package-runtime ext with valid bundle + checksum so re-verify passes,
    // then the package_runtime_deferred guard fires.
    const pkgBundle = JSON.stringify({
      runtime: "package",
      entry: "dist/index.js",
    });
    const extensions = [
      {
        id: "ext-pkg",
        name: "pkg-ext",
        runtime: "package" as const,
        entry: "dist/index.js",
        source: { kind: "authored" as const },
        checksum: computeAssetChecksum(pkgBundle),
        bundle: pkgBundle,
      },
    ];

    const staged = stageExtensionAssets(stageDir, extensions);
    // package runtime: skipped, not staged.
    expect(staged).toHaveLength(0);
  });

  it("stages multiple ts-module extensions and drops malformed ones without affecting siblings", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    const goodSource1 = "export default function extA() { return {}; }";
    const goodSource2 = "export default function extB() { return {}; }";
    const extensions = [
      makeValidTsExt({
        id: "ext-good-1",
        name: "ext-a",
        moduleSource: goodSource1,
        entry: "src/a.ts",
      }),
      // Deliberately mismatched checksum — dropped by re-verify guard.
      {
        id: "ext-bad",
        name: "broken",
        runtime: "ts-module" as const,
        entry: "src/bad.ts",
        source: { kind: "authored" as const },
        checksum:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
      makeValidTsExt({
        id: "ext-good-2",
        name: "ext-b",
        moduleSource: goodSource2,
        entry: "src/b.ts",
      }),
    ];

    const staged = stageExtensionAssets(stageDir, extensions);
    // Only 2 valid extensions staged.
    expect(staged).toHaveLength(2);
    const stagedContents = staged.map((p) => readFileSync(p, "utf-8"));
    expect(stagedContents).toContain(goodSource1);
    expect(stagedContents).toContain(goodSource2);
  });

  it("does not name a staged file index.ts (PI loader excludes index.ts)", async () => {
    const { stageExtensionAssets } =
      await import("../src/contribution-extension-staging.js");

    const extensions = [
      makeValidTsExt({
        id: "ext-index",
        name: "index",
        moduleSource: "export default function idx() { return {}; }",
      }),
    ];

    const staged = stageExtensionAssets(stageDir, extensions);
    expect(staged).toHaveLength(1);
    expect(staged[0]).not.toMatch(/index\.ts$/);
  });
});

// ---------------------------------------------------------------------------
// PiEngine integration — extension staging wired into createSession
// ---------------------------------------------------------------------------

describe("PiEngine — extension asset staging integration", () => {
  let PiEngine: Awaited<
    ReturnType<typeof import("../src/pi-engine.js")>
  >["PiEngine"];
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockModelRegistryFind.mockReturnValue({
      id: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
    });
    mockSessionManagerCreate.mockReturnValue({
      branch: vi.fn(),
      getLeafEntry: vi.fn().mockReturnValue(undefined),
    });
    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()), dispose: vi.fn() },
    });
    mockResourceLoaderInstance.reload.mockResolvedValue(undefined);
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-ext-staging-"));
    const mod = await import("../src/pi-engine.js");
    PiEngine = mod.PiEngine;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stages a ts-module extension file BEFORE resolveExtensionPaths is called (file present when loader ctor runs)", async () => {
    const engine = new PiEngine();
    const moduleSource = "export default function myExt() { return {}; }";
    const ctx = makeCtx(tmpDir, {
      ...EMPTY_CONTRIBUTIONS,
      extensions: [
        makeValidTsExt({
          id: "ext-integration",
          name: "my-ext",
          moduleSource,
          entry: "src/main.ts",
        }),
      ],
    });

    await engine.createSession(BASE_RUNTIME_CONFIG, ctx);

    // At least one .ts file must have been written (the staged extension).
    const tsFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".ts"));
    expect(tsFiles.length).toBeGreaterThan(0);

    // One of the .ts files must be the staged extension (not index.ts).
    const extensionFiles = tsFiles.filter((f) => f !== "index.ts");
    expect(extensionFiles.length).toBeGreaterThan(0);

    // The DefaultResourceLoader ctor received additionalExtensionPaths that
    // includes the staged extension.
    const ctorCall = mockDefaultResourceLoaderCtor.mock.calls[0];
    expect(ctorCall).toBeDefined();
    const loaderOptions = ctorCall?.[0] as {
      additionalExtensionPaths?: string[];
    };
    const extPaths = loaderOptions?.additionalExtensionPaths ?? [];
    const stagedPath = extPaths.find((p) => !p.endsWith("index.ts"));
    expect(stagedPath).toBeDefined();
    expect(existsSync(stagedPath!)).toBe(true);
    expect(readFileSync(stagedPath!, "utf-8")).toBe(moduleSource);
  });

  it("empty extensions ⇒ no extra .ts files staged (byte-identical to EPIC-210 baseline)", async () => {
    const engine = new PiEngine();
    const ctx = makeCtx(tmpDir, EMPTY_CONTRIBUTIONS);

    await engine.createSession(BASE_RUNTIME_CONFIG, ctx);

    // No hook extension either (empty hooks), so no .ts files at all.
    const tsFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".ts"));
    expect(tsFiles).toHaveLength(0);
  });

  it("staged extension files are cleaned up on session dispose", async () => {
    const engine = new PiEngine();
    const moduleSource = "export default function disposeExt() { return {}; }";
    const ctx = makeCtx(tmpDir, {
      ...EMPTY_CONTRIBUTIONS,
      extensions: [
        makeValidTsExt({
          id: "ext-dispose",
          name: "dispose-ext",
          moduleSource,
          entry: "src/dispose.ts",
        }),
      ],
    });

    const session = await engine.createSession(BASE_RUNTIME_CONFIG, ctx);

    // File is present before dispose.
    const tsFilesBefore = readdirSync(tmpDir).filter(
      (f) => f.endsWith(".ts") && f !== "index.ts",
    );
    expect(tsFilesBefore.length).toBeGreaterThan(0);

    // Dispose the session — triggers cleanup.
    await session.dispose();

    // Extension file must be gone after dispose.
    const tsFilesAfter = readdirSync(tmpDir).filter(
      (f) => f.endsWith(".ts") && f !== "index.ts",
    );
    expect(tsFilesAfter).toHaveLength(0);
  });
});
