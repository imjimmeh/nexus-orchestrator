import { describe, it, expect, beforeEach } from "vitest";
import { PluginLifecycleService } from "./plugin-lifecycle.service";
import type { PluginManifestDiscoveryResult } from "../plugin-platform.types";
import type {
  PluginLifecycleResponse,
  PluginLifecycleListResponse,
} from "./plugin-lifecycle.types";

/**
 * Create a minimal PluginManifestDiscoveryResult for seeding the service.
 */
function makeDiscoveryResult(
  pluginId: string,
  manifestPath = `/plugins/${pluginId}/plugin.json`,
): PluginManifestDiscoveryResult {
  return {
    manifestPath,
    sourceDirectory: `/plugins/${pluginId}`,
    manifest: {
      id: pluginId,
      name: `Plugin ${pluginId}`,
      version: "1.0.0",
    },
    isValid: true,
    errors: [],
    discoveredAt: new Date(),
  };
}

describe("PluginLifecycleService", () => {
  let service: PluginLifecycleService;

  beforeEach(() => {
    service = new PluginLifecycleService();
  });

  describe("install flow", () => {
    it("installs a discovered plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-a")]);

      const result = await service.install("plugin-a");

      expect(result).toEqual<PluginLifecycleResponse>({
        success: true,
        pluginId: "plugin-a",
        operation: "install",
        state: "installed",
      });
    });

    it("fails to install an unknown plugin", async () => {
      const result = await service.install("no-such-plugin");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Plugin not found");
      expect(result.state).toBe("unknown");
    });

    it("is idempotent: installing an already-installed plugin succeeds", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-a")]);

      await service.install("plugin-a");
      const result = await service.install("plugin-a");

      expect(result).toEqual<PluginLifecycleResponse>({
        success: true,
        pluginId: "plugin-a",
        operation: "install",
        state: "installed",
      });
    });
  });

  describe("enable/disable cycle", () => {
    it("enables an installed plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-b")]);
      await service.install("plugin-b");

      const result = await service.enable("plugin-b");

      expect(result).toEqual<PluginLifecycleResponse>({
        success: true,
        pluginId: "plugin-b",
        operation: "enable",
        state: "enabled",
      });
    });

    it("disables an enabled plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-b")]);
      await service.install("plugin-b");
      await service.enable("plugin-b");

      const result = await service.disable("plugin-b");

      expect(result).toEqual<PluginLifecycleResponse>({
        success: true,
        pluginId: "plugin-b",
        operation: "disable",
        state: "disabled",
      });
    });

    it("re-enables a disabled plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-b")]);
      await service.install("plugin-b");
      await service.enable("plugin-b");
      await service.disable("plugin-b");

      const result = await service.enable("plugin-b");

      expect(result).toEqual<PluginLifecycleResponse>({
        success: true,
        pluginId: "plugin-b",
        operation: "enable",
        state: "enabled",
      });
    });

    it("is idempotent: enabling an already-enabled plugin succeeds", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-b")]);
      await service.install("plugin-b");
      await service.enable("plugin-b");

      const result = await service.enable("plugin-b");

      expect(result.success).toBe(true);
      expect(result.state).toBe("enabled");
    });

    it("is idempotent: disabling an already-disabled plugin succeeds", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-b")]);
      await service.install("plugin-b");
      await service.enable("plugin-b");
      await service.disable("plugin-b");

      const result = await service.disable("plugin-b");

      expect(result.success).toBe(true);
      expect(result.state).toBe("disabled");
    });
  });

  describe("uninstall flow", () => {
    it("uninstalls an installed plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-c")]);
      await service.install("plugin-c");

      const result = await service.uninstall("plugin-c");

      expect(result).toEqual<PluginLifecycleResponse>({
        success: true,
        pluginId: "plugin-c",
        operation: "uninstall",
        state: "uninstalled",
      });
    });

    it("uninstalls a disabled plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-c")]);
      await service.install("plugin-c");
      await service.enable("plugin-c");
      await service.disable("plugin-c");

      const result = await service.uninstall("plugin-c");

      expect(result.success).toBe(true);
      expect(result.state).toBe("uninstalled");
    });
  });

  describe("invalid state transitions", () => {
    it("cannot enable a discovered-but-not-installed plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-d")]);

      const result = await service.enable("plugin-d");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid state transition");
      expect(result.error).toContain("discovered");
    });

    it("cannot disable an installed-but-not-enabled plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-e")]);
      await service.install("plugin-e");

      const result = await service.disable("plugin-e");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid state transition");
      expect(result.error).toContain("installed");
    });

    it("cannot uninstall an enabled plugin (must disable first)", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-f")]);
      await service.install("plugin-f");
      await service.enable("plugin-f");

      const result = await service.uninstall("plugin-f");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid state transition");
      expect(result.error).toContain("enabled");
    });

    it("cannot install an uninstalled plugin again (no re-install)", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-g")]);
      await service.install("plugin-g");
      await service.uninstall("plugin-g");

      const result = await service.install("plugin-g");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid state transition");
      expect(result.error).toContain("uninstalled");
    });

    it("cannot disable a discovered-only plugin", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("plugin-h")]);

      const result = await service.disable("plugin-h");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid state transition");
    });

    it("cannot enable an unknown plugin", async () => {
      const result = await service.enable("no-such-plugin");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Plugin not found");
    });
  });

  describe("list()", () => {
    it("returns an empty list when no plugins have been seeded", () => {
      const list = service.list();

      expect(list).toEqual<PluginLifecycleListResponse>({ plugins: [] });
    });

    it("returns all known plugins with their states", async () => {
      service.seedFromDiscovery([
        makeDiscoveryResult("p1", "/plugins/p1/plugin.json"),
        makeDiscoveryResult("p2", "/plugins/p2/plugin.json"),
        makeDiscoveryResult("p3", "/plugins/p3/plugin.json"),
      ]);

      await service.install("p1");
      await service.install("p2");
      await service.enable("p2");

      const list = service.list();

      expect(list.plugins).toHaveLength(3);

      const p1 = list.plugins.find((p) => p.pluginId === "p1");
      const p2 = list.plugins.find((p) => p.pluginId === "p2");
      const p3 = list.plugins.find((p) => p.pluginId === "p3");

      expect(p1?.state).toBe("installed");
      expect(p1?.manifestRef).toBe("/plugins/p1/plugin.json");
      expect(p2?.state).toBe("enabled");
      expect(p3?.state).toBe("discovered");
    });

    it("includes manifestRef for each plugin", () => {
      service.seedFromDiscovery([
        makeDiscoveryResult("ref-test", "/custom/path/to/plugin.json"),
      ]);

      const list = service.list();

      expect(list.plugins[0].manifestRef).toBe("/custom/path/to/plugin.json");
    });
  });

  describe("seedFromDiscovery", () => {
    it("ignores results with empty plugin id", () => {
      const badResult: PluginManifestDiscoveryResult = {
        manifestPath: "/plugins/bad/plugin.json",
        sourceDirectory: "/plugins/bad",
        manifest: {
          id: "",
          name: "Bad Plugin",
          version: "1.0.0",
        },
        isValid: false,
        errors: [],
        discoveredAt: new Date(),
      };

      service.seedFromDiscovery([badResult]);

      const list = service.list();
      expect(list.plugins).toHaveLength(0);
    });

    it("does not overwrite existing state when re-seeding", async () => {
      service.seedFromDiscovery([makeDiscoveryResult("existing")]);
      await service.install("existing");

      // Re-seed with same plugin
      service.seedFromDiscovery([
        makeDiscoveryResult("existing", "/new/path/plugin.json"),
      ]);

      const list = service.list();
      expect(list.plugins).toHaveLength(1);
      expect(list.plugins[0].state).toBe("installed");
      // manifestPath should be updated though
      expect(list.plugins[0].manifestRef).toBe("/new/path/plugin.json");
    });
  });
});
