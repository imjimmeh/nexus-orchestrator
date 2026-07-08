import fs from "node:fs/promises";
import path from "node:path";
import {
  getConfigDirPath,
  getConfigFilePath,
  getDefaultConfig,
} from "./defaults.js";
import type { ConfigSettableKey, LocalAgentConfig } from "./config.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const allStrings = value.every((entry) => typeof entry === "string");
  return allStrings ? [...value] : null;
}

function mergeConfig(raw: unknown): LocalAgentConfig {
  const defaults = getDefaultConfig();
  if (!isRecord(raw)) {
    return defaults;
  }

  const allowedRoots = toStringArray(raw.allowedRoots) ?? defaults.allowedRoots;
  const allowPatterns =
    toStringArray(raw.allowPatterns) ?? defaults.allowPatterns;

  return {
    host: typeof raw.host === "string" ? raw.host : defaults.host,
    port: typeof raw.port === "number" ? raw.port : defaults.port,
    allowedRoots,
    allowPatterns,
    defaultCommandTimeoutMs:
      typeof raw.defaultCommandTimeoutMs === "number"
        ? raw.defaultCommandTimeoutMs
        : defaults.defaultCommandTimeoutMs,
    maxFileBytes:
      typeof raw.maxFileBytes === "number"
        ? raw.maxFileBytes
        : defaults.maxFileBytes,
    logToStdout:
      typeof raw.logToStdout === "boolean"
        ? raw.logToStdout
        : defaults.logToStdout,
  };
}

export class ConfigService {
  private config: LocalAgentConfig;

  private constructor(config: LocalAgentConfig) {
    this.config = config;
  }

  static async create(): Promise<ConfigService> {
    const service = new ConfigService(getDefaultConfig());
    const loaded = await service.loadFromDisk();
    service.config = loaded;
    return service;
  }

  getConfig(): LocalAgentConfig {
    return this.config;
  }

  async loadFromDisk(): Promise<LocalAgentConfig> {
    const configPath = getConfigFilePath();
    try {
      const contents = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(contents) as unknown;
      return mergeConfig(parsed);
    } catch {
      return getDefaultConfig();
    }
  }

  async save(config: LocalAgentConfig): Promise<void> {
    await fs.mkdir(getConfigDirPath(), { recursive: true });
    const serialized = JSON.stringify(config, null, 2) + "\n";
    await fs.writeFile(getConfigFilePath(), serialized, "utf8");
    this.config = config;
  }

  async setValue(key: ConfigSettableKey, rawValue: string): Promise<void> {
    const current = this.getConfig();
    const next: LocalAgentConfig = {
      ...current,
    };

    if (key === "host") {
      next.host = rawValue;
    }

    if (key === "port") {
      next.port = Number.parseInt(rawValue, 10);
    }

    if (key === "allowedRoots") {
      next.allowedRoots = rawValue
        .split(path.delimiter)
        .map((value) => path.resolve(value.trim()))
        .filter((value) => value.length > 0);
    }

    if (key === "allowPatterns") {
      next.allowPatterns = rawValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    }

    if (key === "defaultCommandTimeoutMs") {
      next.defaultCommandTimeoutMs = Number.parseInt(rawValue, 10);
    }

    if (key === "maxFileBytes") {
      next.maxFileBytes = Number.parseInt(rawValue, 10);
    }

    if (key === "logToStdout") {
      next.logToStdout = rawValue === "true";
    }

    await this.save(next);
  }
}
