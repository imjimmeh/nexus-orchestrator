import { Injectable } from "@nestjs/common";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pluginManifestSchema } from "@nexus/plugin-sdk";

import type { PluginManifestDiscoveryResult } from "../plugin-platform.types";
import type {
  ManifestReadError,
  PluginManifestDiscoveryOptions,
  PluginManifestDiscoveryScanResult,
} from "./plugin-manifest-discovery.types";

const DEFAULT_FILE_PATTERN = "plugin.json";

/**
 * Service that discovers plugin manifest files from configured directories.
 *
 * Manifests are validated against the plugin-sdk's PluginManifest schema.
 * Missing directories are handled gracefully (no crash).
 */
@Injectable()
export class PluginManifestDiscoveryService {
  private readonly defaultOptions: PluginManifestDiscoveryOptions = {
    directories: [],
    filePattern: DEFAULT_FILE_PATTERN,
    recursive: false,
  };

  /**
   * Discover plugin manifests from the configured directories.
   *
   * @param options - Discovery options (merged with defaults).
   * @returns Aggregated scan result with discovered manifests and errors.
   */
  async discover(
    options: Partial<PluginManifestDiscoveryOptions> = {},
  ): Promise<PluginManifestDiscoveryScanResult> {
    const merged: PluginManifestDiscoveryOptions = {
      ...this.defaultOptions,
      ...options,
      directories: options.directories ?? this.defaultOptions.directories,
    };

    const manifests: PluginManifestDiscoveryResult[] = [];
    const errors: ManifestReadError[] = [];
    let filesFound = 0;

    const directoriesScanned = merged.directories.length;

    for (const directory of merged.directories) {
      const resolvedDir = resolve(directory);

      try {
        const dirStat = await stat(resolvedDir);

        if (!dirStat.isDirectory()) {
          errors.push({
            filePath: resolvedDir,
            message: `Not a directory: ${resolvedDir}`,
          });
          continue;
        }
      } catch {
        // Directory does not exist or is inaccessible — gracefully skip
        continue;
      }

      try {
        const entries = await readdir(resolvedDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile()) {
            continue;
          }

          if (entry.name !== merged.filePattern) {
            continue;
          }

          filesFound++;

          const manifestPath = join(resolvedDir, entry.name);

          const result = await this.readAndValidateManifest(
            manifestPath,
            resolvedDir,
          );

          if (result.errors.length > 0) {
            errors.push({
              filePath: manifestPath,
              message: result.errors.join("; "),
            });
          }

          manifests.push(result);
        }
      } catch (readErr) {
        const message =
          readErr instanceof Error ? readErr.message : String(readErr);
        errors.push({
          filePath: resolvedDir,
          message: `Failed to read directory: ${message}`,
        });
      }
    }

    return {
      manifests,
      errors,
      directoriesScanned,
      filesFound,
      scannedAt: new Date(),
    };
  }

  /**
   * Read a manifest file from disk and validate it against the schema.
   */
  private async readAndValidateManifest(
    manifestPath: string,
    sourceDirectory: string,
  ): Promise<PluginManifestDiscoveryResult> {
    const discoveredAt = new Date();
    const validationErrors: string[] = [];
    let manifestId = "";
    let manifestName = "";
    let manifestVersion = "";

    try {
      const rawContent = await readFile(manifestPath, "utf-8");
      const parsed = pluginManifestSchema.parse(JSON.parse(rawContent));

      manifestId = parsed.id;
      manifestName = parsed.name;
      manifestVersion = parsed.version;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      validationErrors.push(message);

      // Attempt a best-effort extraction even if validation failed
      try {
        const rawContent = await readFile(manifestPath, "utf-8");
        const partial = JSON.parse(rawContent) as Record<string, unknown>;

        if (typeof partial.id === "string") {
          manifestId = partial.id;
        }
        if (typeof partial.name === "string") {
          manifestName = partial.name;
        }
        if (typeof partial.version === "string") {
          manifestVersion = partial.version;
        }
      } catch {
        // Best-effort extraction failed; leave fields empty
      }
    }

    return {
      manifestPath,
      sourceDirectory,
      manifest: {
        id: manifestId,
        name: manifestName,
        version: manifestVersion,
      },
      isValid: validationErrors.length === 0,
      errors: validationErrors,
      discoveredAt,
    };
  }
}
