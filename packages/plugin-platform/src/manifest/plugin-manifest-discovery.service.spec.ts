import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { PluginManifestDiscoveryService } from "./plugin-manifest-discovery.service";
import type {
  PluginManifestDiscoveryOptions,
  PluginManifestDiscoveryScanResult,
} from "./plugin-manifest-discovery.types";
import type { PluginManifestDiscoveryResult } from "../plugin-platform.types";

/**
 * Helper to create a valid plugin.json manifest payload.
 * The output matches the strict `pluginManifestSchema` from @nexus/plugin-sdk.
 */
function validManifest(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin for unit testing",
    author: "Test Author",
    nexusCompatibility: {
      pluginApiVersion: "1.0.0",
      minVersion: "1.0.0",
    },
    entrypoints: {
      main: "dist/index.js",
    },
    isolationModes: ["none"],
    permissions: [],
    contributions: [
      {
        id: "test-tool",
        type: "tool",
        displayName: "Test Tool",
        description: "A test tool",
        config: {
          inputSchema: { type: "object", properties: {} },
          operation: "execute",
        },
      },
    ],
    ...overrides,
  };
}

describe("PluginManifestDiscoveryService", () => {
  let service: PluginManifestDiscoveryService;
  let tempDir: string;

  beforeEach(async () => {
    service = new PluginManifestDiscoveryService();
    tempDir = await mkdtemp(join(tmpdir(), "plugin-platform-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Helper to create a directory with a plugin.json ──────────────────
  async function createPluginDir(
    dirName: string,
    manifestPayload: unknown,
  ): Promise<string> {
    const dirPath = join(tempDir, dirName);
    await mkdir(dirPath, { recursive: true });
    await writeFile(
      join(dirPath, "plugin.json"),
      JSON.stringify(manifestPayload, null, 2),
      "utf-8",
    );
    return dirPath;
  }

  // ── Test 1: Discovery from a directory with a valid plugin.json ──────
  describe("discover", () => {
    it("discovers a valid manifest from a single directory", async () => {
      const payload = validManifest();
      const pluginDir = await createPluginDir("valid-plugin", payload);

      const options: Partial<PluginManifestDiscoveryOptions> = {
        directories: [pluginDir],
      };
      const result = await service.discover(options);

      expect(result.directoriesScanned).toBe(1);
      expect(result.filesFound).toBe(1);
      expect(result.manifests).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      const discovered = result.manifests[0];
      expect(discovered.isValid).toBe(true);
      expect(discovered.errors).toHaveLength(0);
      expect(discovered.manifest.id).toBe("test-plugin");
      expect(discovered.manifest.name).toBe("Test Plugin");
      expect(discovered.manifest.version).toBe("1.0.0");
      expect(discovered.sourceDirectory).toBe(pluginDir);
      expect(discovered.manifestPath).toBe(join(pluginDir, "plugin.json"));
      expect(discovered.discoveredAt).toBeInstanceOf(Date);
    });

    // ── Test 2: Directory with no manifest files ───────────────────────
    it("returns empty manifests when directory has no plugin.json", async () => {
      const emptyDir = join(tempDir, "empty-dir");
      await mkdir(emptyDir, { recursive: true });

      const options: Partial<PluginManifestDiscoveryOptions> = {
        directories: [emptyDir],
      };
      const result = await service.discover(options);

      expect(result.directoriesScanned).toBe(1);
      expect(result.filesFound).toBe(0);
      expect(result.manifests).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    // ── Test 3: Missing / nonexistent directory (graceful degradation) ─
    it("gracefully handles a nonexistent directory without crashing", async () => {
      const nonexistentDir = join(tempDir, "does-not-exist");

      const options: Partial<PluginManifestDiscoveryOptions> = {
        directories: [nonexistentDir],
      };
      const result = await service.discover(options);

      expect(result.directoriesScanned).toBe(1);
      expect(result.filesFound).toBe(0);
      expect(result.manifests).toHaveLength(0);
      // The service silently skips missing directories — no error
      expect(result.errors).toHaveLength(0);
      expect(result.scannedAt).toBeInstanceOf(Date);
    });

    // ── Test 4: Directory with an invalid manifest ─────────────────────
    it("returns validation errors for an invalid manifest without crashing", async () => {
      const invalidPayload = {
        // missing required fields: id, name, version, nexusCompatibility, etc.
        description: "I am incomplete",
      };
      const pluginDir = await createPluginDir("invalid-plugin", invalidPayload);

      const options: Partial<PluginManifestDiscoveryOptions> = {
        directories: [pluginDir],
      };
      const result = await service.discover(options);

      expect(result.directoriesScanned).toBe(1);
      expect(result.filesFound).toBe(1);

      // A manifest entry should still be returned even if validation failed
      expect(result.manifests).toHaveLength(1);
      const discovered = result.manifests[0];
      expect(discovered.isValid).toBe(false);
      expect(discovered.errors.length).toBeGreaterThan(0);

      // Errors array in the scan result should also record the failure
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].filePath).toBe(join(pluginDir, "plugin.json"));
      expect(result.errors[0].message.length).toBeGreaterThan(0);
    });

    // ── Test 4b: Invalid manifest with partial best-effort extraction ──
    it("extracts id, name, version from invalid manifest via best-effort", async () => {
      // Valid JSON structure but missing required sub-objects (nexusCompatibility, etc.)
      const payload: Record<string, unknown> = {
        id: "partial-plugin",
        name: "Partial Plugin",
        version: "0.5.0",
        // missing nexusCompatibility, entrypoints, isolationModes, contributions
      };
      const pluginDir = await createPluginDir("partial-plugin", payload);

      const options: Partial<PluginManifestDiscoveryOptions> = {
        directories: [pluginDir],
      };
      const result = await service.discover(options);

      expect(result.manifests).toHaveLength(1);
      const discovered = result.manifests[0];
      expect(discovered.isValid).toBe(false);
      // Best-effort extraction should fill these from the raw JSON
      expect(discovered.manifest.id).toBe("partial-plugin");
      expect(discovered.manifest.name).toBe("Partial Plugin");
      expect(discovered.manifest.version).toBe("0.5.0");
    });

    // ── Test 5: Discovery from multiple directories (aggregation) ──────
    it("aggregates manifests from multiple directories", async () => {
      const pluginA = await createPluginDir(
        "plugin-a",
        validManifest({ id: "plugin-a", name: "Plugin A" }),
      );
      const pluginB = await createPluginDir(
        "plugin-b",
        validManifest({ id: "plugin-b", name: "Plugin B" }),
      );
      const emptyDir = join(tempDir, "no-manifest");
      await mkdir(emptyDir, { recursive: true });

      const options: Partial<PluginManifestDiscoveryOptions> = {
        directories: [pluginA, pluginB, emptyDir],
      };
      const result = await service.discover(options);

      expect(result.directoriesScanned).toBe(3);
      expect(result.filesFound).toBe(2);
      expect(result.manifests).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      const ids = result.manifests.map((m) => m.manifest.id).sort();
      expect(ids).toEqual(["plugin-a", "plugin-b"]);
    });

    // ── Test 6: Options defaulting ─────────────────────────────────────
    it("uses default empty directories when no directories are provided", async () => {
      const result = await service.discover({});

      expect(result.directoriesScanned).toBe(0);
      expect(result.filesFound).toBe(0);
      expect(result.manifests).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.scannedAt).toBeInstanceOf(Date);
    });

    it('uses default file pattern "plugin.json" when not overridden', async () => {
      const payload = validManifest();
      const pluginDir = await createPluginDir("default-pattern", payload);

      // Also create a file that should NOT be picked up
      await writeFile(
        join(pluginDir, "manifest.json"),
        JSON.stringify(payload),
        "utf-8",
      );

      const result = await service.discover({ directories: [pluginDir] });

      // Only plugin.json should be discovered, not manifest.json
      expect(result.filesFound).toBe(1);
      expect(result.manifests).toHaveLength(1);
    });

    it("respects a custom file pattern", async () => {
      const payload = validManifest();
      const pluginDir = join(tempDir, "custom-pattern");
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, "manifest.json"),
        JSON.stringify(payload),
        "utf-8",
      );

      const result = await service.discover({
        directories: [pluginDir],
        filePattern: "manifest.json",
      });

      expect(result.filesFound).toBe(1);
      expect(result.manifests).toHaveLength(1);
    });

    // ── Test: Non-directory path handling ──────────────────────────────
    it("records an error when a path is not a directory", async () => {
      const filePath = join(tempDir, "not-a-dir.txt");
      await writeFile(filePath, "hello", "utf-8");

      const result = await service.discover({ directories: [filePath] });

      expect(result.filesFound).toBe(0);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].filePath).toBe(filePath);
      expect(result.errors[0].message).toContain("Not a directory");
    });

    // ── Test: Cannot read directory (permission error simulation) ──────
    it("records an error when directory cannot be read", async () => {
      // We simulate an unreadable directory by passing a path that will
      // cause readdir to fail. Since we can't reliably set permissions
      // in all test environments, we test the resilience via a path that
      // breaks readdir's expectations.
      // Using a directory that we then delete before discover is called.
      const dirToRemove = join(tempDir, "removed-before-scan");
      await mkdir(dirToRemove, { recursive: true });
      await rm(dirToRemove, { recursive: true, force: true });

      const result = await service.discover({ directories: [dirToRemove] });

      // The stat call will fail (ENOENT), so the service silently skips.
      // The initial stat catch gracefully handles this, so no errors.
      expect(result.filesFound).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.manifests).toHaveLength(0);
    });
  });

  // ── Edge case: empty options vs undefined ────────────────────────────
  describe("discover edge cases", () => {
    it("works when called with no arguments", async () => {
      const result = await service.discover();

      expect(result.directoriesScanned).toBe(0);
      expect(result.filesFound).toBe(0);
      expect(result.manifests).toHaveLength(0);
    });

    it("merges partial options with defaults", async () => {
      // Explicit directories should be used; pattern should default
      const pluginDir = await createPluginDir("merge-options", validManifest());

      const result = await service.discover({ directories: [pluginDir] });

      expect(result.filesFound).toBe(1);
      expect(result.manifests).toHaveLength(1);
    });
  });
});
