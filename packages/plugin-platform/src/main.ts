#!/usr/bin/env node

/**
 * Standalone executable entrypoint for the Plugin Platform service.
 *
 * Usage:
 *   npx tsx src/main.ts
 *   node dist/main.js
 *
 * Configuration via environment variables:
 *   PLUGIN_MANIFEST_DIRS - comma-separated list of directories (default: ./plugins)
 *   PLUGIN_DEFAULT_ISOLATION - default isolation mode (default: none)
 *   PLUGIN_HEALTH_ENABLED - enable health endpoint (default: true)
 *   PLUGIN_HEALTH_PATH - health endpoint path (default: /health/plugins)
 *   PLUGIN_HEALTH_PROBE_TIMEOUT_MS - probe timeout in ms (default: 5000)
 *   PLUGIN_HTTP_PORT - HTTP server port (default: 3000)
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import { PluginLifecycleService } from "./api/plugin-lifecycle.service";
import { PluginLifecycleController } from "./api/plugin-lifecycle.controller";
import { RuntimeManager } from "./runtime/runtime-manager";
import { PluginPlatformService } from "./service/plugin-platform-service";
import type {
  PluginPlatformConfig,
  IsolationMode,
  PluginManifestDiscoveryResult,
} from "./plugin-platform.types";

function readConfig(): PluginPlatformConfig {
  const dirsEnv = process.env.PLUGIN_MANIFEST_DIRS ?? "./plugins";
  const manifestDirectories = dirsEnv
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const isolationEnv = process.env.PLUGIN_DEFAULT_ISOLATION ?? "none";
  const validIsolations = ["none", "worker_process", "container"];
  const defaultIsolationMode: IsolationMode = validIsolations.includes(
    isolationEnv,
  )
    ? (isolationEnv as IsolationMode)
    : "none";

  const healthEnabled = process.env.PLUGIN_HEALTH_ENABLED !== "false";
  const healthPath = process.env.PLUGIN_HEALTH_PATH ?? "/health/plugins";
  const healthProbeTimeout = Number.parseInt(
    process.env.PLUGIN_HEALTH_PROBE_TIMEOUT_MS ?? "5000",
    10,
  );

  return {
    manifestDirectories,
    defaultIsolationMode,
    healthCheck: {
      enabled: healthEnabled,
      path: healthPath,
      probeTimeoutMs: healthProbeTimeout,
    },
  };
}

function logComponentHealth(
  label: string,
  healthy: boolean,
  details?: string,
): void {
  const status = healthy ? "healthy" : "degraded";
  const extra = details ? ` - ${details}` : "";
  console.log(`[plugin-platform] ${label}: ${status}${extra}`);
}

async function startHttpServer(
  controller: PluginLifecycleController,
  port: number,
): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = createServer((req, res) => {
      void controller.handleRequest(req, res);
    });

    server.on("error", reject);

    server.listen(port, () => {
      console.log(`[plugin-platform] HTTP server listening on port ${port}`);
      resolve(server);
    });
  });
}

async function main(): Promise<void> {
  const config = readConfig();
  const httpPort = Number.parseInt(process.env.PLUGIN_HTTP_PORT ?? "3000", 10);

  console.log("[plugin-platform] Starting Plugin Platform Service...");
  console.log("[plugin-platform] Config:", {
    manifestDirectories: config.manifestDirectories,
    defaultIsolationMode: config.defaultIsolationMode,
    healthCheck: config.healthCheck,
    httpPort,
  });

  // Create all components
  const lifecycle = new PluginLifecycleService();
  const runtimeManager = new RuntimeManager(config.defaultIsolationMode);
  const service = new PluginPlatformService(config);
  const controller = new PluginLifecycleController(service, lifecycle);

  service.on(
    "discovery_complete",
    (payload: {
      manifestsFound: number;
      errors: number;
      manifests: PluginManifestDiscoveryResult[];
    }) => {
      console.log(
        `[plugin-platform] Manifest discovery complete: ${payload.manifestsFound} manifests found, ${payload.errors} errors.`,
      );

      // Seed the lifecycle service using the manifests from the discovery_complete event,
      // avoiding a redundant second discovery scan.
      lifecycle.seedFromDiscovery(payload.manifests);
      console.log(
        `[plugin-platform] Lifecycle service seeded with ${payload.manifests.length} plugins.`,
      );
    },
  );

  // Start the HTTP server
  let httpServer: Server | null = null;
  try {
    httpServer = await startHttpServer(controller, httpPort);
  } catch (err) {
    console.error("[plugin-platform] Failed to start HTTP server:", err);
    process.exit(1);
  }

  // Start the service (runs manifest discovery)
  await service.start();

  // Log all component health statuses
  console.log("[plugin-platform] Service started. Component health:");
  const serviceHealth = service.getHealth();
  logComponentHealth(
    "Platform Service",
    serviceHealth.status === "ok",
    `discovered ${serviceHealth.plugins_discovered} plugins, uptime ${serviceHealth.uptime_ms}ms`,
  );

  const runtimeHealth = runtimeManager.getHealth();
  logComponentHealth(
    "Runtime Manager",
    runtimeHealth.healthy,
    `${runtimeHealth.mode} mode${runtimeHealth.details ? ` - ${runtimeHealth.details}` : ""}`,
  );

  // List all known plugins from lifecycle service
  const pluginList = lifecycle.list();
  logComponentHealth(
    "Lifecycle Service",
    true,
    `${pluginList.plugins.length} plugins tracked`,
  );

  // Shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`[plugin-platform] Received ${signal}. Shutting down...`);

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
      console.log("[plugin-platform] HTTP server stopped.");
    }

    await service.stop();
    console.log("[plugin-platform] Service stopped.");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err: unknown) => {
  console.error("[plugin-platform] Fatal error:", err);
  process.exit(1);
});
