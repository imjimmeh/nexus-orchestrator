import os from "node:os";
import path from "node:path";
import type { LocalAgentConfig } from "./config.types.js";

const DEFAULT_PORT = 3033;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_FILE_BYTES = 1_000_000_000;

export function getDefaultConfig(): LocalAgentConfig {
  return {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    allowedRoots: [path.resolve(os.homedir())],
    allowPatterns: [],
    defaultCommandTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    logToStdout: true,
  };
}

export function getConfigDirPath(): string {
  return path.resolve(os.homedir(), ".nexus-agent-local");
}

export function getConfigFilePath(): string {
  return path.resolve(getConfigDirPath(), "config.json");
}

export function getLogsDirPath(): string {
  return path.resolve(getConfigDirPath(), "logs");
}
