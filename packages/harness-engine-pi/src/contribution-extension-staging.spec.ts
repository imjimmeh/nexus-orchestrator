/**
 * Unit tests for contribution-extension-staging.ts (real-filesystem tests).
 *
 * All tests in this file use a real temporary directory. Tests that need to
 * simulate FS failures (stage_write_failed) live in the companion
 * contribution-extension-staging.write-failure.spec.ts which mocks node:fs.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeAssetChecksum } from "@nexus/core";
import type { HarnessExtensionAsset } from "@nexus/core";
import {
  stageExtensionAssets,
  stageExtensionAssetsWithDiagnostics,
  cleanupStagedExtensions,
} from "./contribution-extension-staging.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a `HarnessExtensionAsset` for a `ts-module` extension with a
 * canonical bundle and matching checksum.  Overrides are applied AFTER
 * bundle/checksum are computed so that callers that only change `id` or `name`
 * still get a consistent, verifiable asset.
 *
 * Callers that need a deliberate mismatch must supply `checksum` in overrides.
 */
function makeTsModuleExt(
  overrides: Partial<HarnessExtensionAsset> = {},
): HarnessExtensionAsset {
  const runtime = (overrides.runtime as "ts-module") ?? "ts-module";
  const entry = overrides.entry ?? "src/index.ts";
  const moduleSource =
    overrides.moduleSource ?? "export default function run() {}";

  const bundle = JSON.stringify({ runtime, entry, moduleSource });
  const checksum = computeAssetChecksum(bundle);

  return {
    id: "ext-uuid-1",
    name: "my-ext",
    runtime,
    entry,
    source: { kind: "authored" },
    checksum,
    bundle,
    moduleSource,
    ...overrides,
    // Re-apply checksum ONLY if the caller didn't supply one (a deliberate
    // mismatch test sets checksum in overrides, so we must not clobber it).
    ...(overrides.checksum !== undefined
      ? { checksum: overrides.checksum }
      : { checksum }),
  };
}

function makePackageExt(
  overrides: Partial<HarnessExtensionAsset> = {},
): HarnessExtensionAsset {
  const entry = overrides.entry ?? "dist/index.js";
  const bundle = JSON.stringify({ runtime: "package", entry });
  const checksum = computeAssetChecksum(bundle);

  return {
    id: "pkg-uuid-1",
    name: "my-pkg-ext",
    runtime: "package",
    entry,
    source: { kind: "authored" },
    checksum,
    bundle,
    ...overrides,
    ...(overrides.checksum !== undefined
      ? { checksum: overrides.checksum }
      : { checksum }),
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ext-staging-test-"));
}

// ---------------------------------------------------------------------------
// stageExtensionAssets — happy paths
// ---------------------------------------------------------------------------

describe("stageExtensionAssets", () => {
  it("returns empty array when no extensions are given", () => {
    const dir = tmpDir();
    const result = stageExtensionAssets(dir, []);
    expect(result).toEqual([]);
  });

  it("stages a ts-module extension and returns the file path", () => {
    const dir = tmpDir();
    const ext = makeTsModuleExt({ id: "test-id-1" });

    const staged = stageExtensionAssets(dir, [ext]);

    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatch(/ext-test-id-1-mod\.ts$/);
    expect(fs.existsSync(staged[0])).toBe(true);
  });

  it("writes the moduleSource verbatim to the staged file", () => {
    const dir = tmpDir();
    const source = "export const hello = 'world';";
    const ext = makeTsModuleExt({ id: "src-id-2", moduleSource: source });

    const staged = stageExtensionAssets(dir, [ext]);

    expect(staged).toHaveLength(1);
    expect(fs.readFileSync(staged[0], "utf-8")).toBe(source);
  });

  it("creates extensionsPath if it does not exist", () => {
    const base = tmpDir();
    const nestedDir = path.join(base, "a", "b", "c");
    const ext = makeTsModuleExt({ id: "nested-id" });

    stageExtensionAssets(nestedDir, [ext]);

    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  it("stages multiple ts-module extensions independently", () => {
    const dir = tmpDir();
    const extA = makeTsModuleExt({
      id: "aa-uuid",
      moduleSource: "export const a = 1;",
    });
    const extB = makeTsModuleExt({
      id: "bb-uuid",
      moduleSource: "export const b = 2;",
    });

    const staged = stageExtensionAssets(dir, [extA, extB]);

    expect(staged).toHaveLength(2);
    expect(fs.readFileSync(staged[0], "utf-8")).toBe("export const a = 1;");
    expect(fs.readFileSync(staged[1], "utf-8")).toBe("export const b = 2;");
  });
});

// ---------------------------------------------------------------------------
// stageExtensionAssetsWithDiagnostics — drop conditions (real fs)
// ---------------------------------------------------------------------------

describe("stageExtensionAssetsWithDiagnostics — drops + diagnostics", () => {
  it("drops a package-runtime extension and sets reason to package_runtime_deferred", () => {
    const dir = tmpDir();
    const ext = makePackageExt();

    const result = stageExtensionAssetsWithDiagnostics(dir, [ext]);

    expect(result.stagedPaths).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("pkg-uuid-1");
    expect(result.dropped[0].reason).toBe("package_runtime_deferred");
  });

  it("drops a ts-module extension with no moduleSource and sets reason to missing_source", () => {
    const dir = tmpDir();
    const ext = makeTsModuleExt({ moduleSource: undefined });

    const result = stageExtensionAssetsWithDiagnostics(dir, [ext]);

    expect(result.stagedPaths).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("ext-uuid-1");
    expect(result.dropped[0].reason).toBe("missing_source");
  });

  it("drops a ts-module extension with empty moduleSource and sets reason to missing_source", () => {
    const dir = tmpDir();
    const ext = makeTsModuleExt({ moduleSource: "" });

    const result = stageExtensionAssetsWithDiagnostics(dir, [ext]);

    expect(result.dropped[0].reason).toBe("missing_source");
  });

  it("stages a valid extension and drops an invalid sibling in the same call", () => {
    const dir = tmpDir();
    const good = makeTsModuleExt({
      id: "good-uuid",
      moduleSource: "export default 42;",
    });
    const bad = makePackageExt({ id: "pkg-uuid-2" });

    const result = stageExtensionAssetsWithDiagnostics(dir, [good, bad]);

    expect(result.stagedPaths).toHaveLength(1);
    expect(result.stagedPaths[0]).toMatch(/good-uuid/);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toBe("package_runtime_deferred");
  });
});

// ---------------------------------------------------------------------------
// cleanupStagedExtensions
// ---------------------------------------------------------------------------

describe("cleanupStagedExtensions", () => {
  it("removes previously staged files", () => {
    const dir = tmpDir();
    const ext = makeTsModuleExt({ id: "cleanup-id" });
    const [filePath] = stageExtensionAssets(dir, [ext]);
    expect(fs.existsSync(filePath)).toBe(true);

    cleanupStagedExtensions([filePath]);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("does not throw when cleaning up a file that no longer exists", () => {
    expect(() => {
      cleanupStagedExtensions(["/nonexistent/path/ext-x-mod.ts"]);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// afterEach safety net — restore any lingering mocks
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});
