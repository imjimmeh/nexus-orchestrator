#!/usr/bin/env node
import path from "node:path";
import { ConfigService } from "./config/config.service.js";
import type { ConfigSettableKey } from "./config/config.types.js";
import { createHttpServer } from "./http/http-server.js";
import { McpRouter } from "./mcp/mcp-router.js";
import { getToolSchemas } from "./mcp/tool-registry.js";
import { AuditLogger } from "./security/audit-logger.js";
import { PathValidator } from "./security/path-validator.js";
import { ExecTool } from "./tools/exec.tool.js";
import { FileTools } from "./tools/file-tools.js";

const SETTABLE_KEYS: ConfigSettableKey[] = [
  "host",
  "port",
  "allowedRoots",
  "allowPatterns",
  "defaultCommandTimeoutMs",
  "maxFileBytes",
  "logToStdout",
];

function isSettableKey(value: string): value is ConfigSettableKey {
  return SETTABLE_KEYS.includes(value as ConfigSettableKey);
}

async function runStart(configService: ConfigService): Promise<void> {
  const config = configService.getConfig();
  const pathValidator = new PathValidator(
    config.allowedRoots.map((root) => path.resolve(root)),
  );
  const auditLogger = new AuditLogger(config.logToStdout);
  const execTool = new ExecTool(config, pathValidator, auditLogger);
  const fileTools = new FileTools(config, pathValidator, auditLogger);
  const router = new McpRouter(execTool, fileTools);

  const server = createHttpServer(config, router, () => ({
    config,
    tools: getToolSchemas().map((schema) => schema.name),
    startupTime: new Date().toISOString(),
  }));

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(
        `nexus-agent-local listening on http://${config.host}:${String(config.port)}`,
      );
      resolve();
    });
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runConfigCommand(
  configService: ConfigService,
  args: string[],
): Promise<void> {
  const sub = args[0];

  if (sub === "get") {
    console.log(JSON.stringify(configService.getConfig(), null, 2));
    return;
  }

  if (sub === "set") {
    const key = args[1];
    const value = args.slice(2).join(" ");

    if (!key || value.length === 0 || !isSettableKey(key)) {
      console.error("Usage: nexus-agent-local config set <key> <value>");
      process.exitCode = 1;
      return;
    }

    await configService.setValue(key, value);
    console.log("ok");
    return;
  }

  console.error("Usage: nexus-agent-local config get|set ...");
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "start";

  const configService = await ConfigService.create();

  if (command === "start") {
    await runStart(configService);
    return;
  }

  if (command === "config") {
    await runConfigCommand(configService, args.slice(1));
    return;
  }

  console.error("Usage: nexus-agent-local start|config");
  process.exitCode = 1;
}

void main();
