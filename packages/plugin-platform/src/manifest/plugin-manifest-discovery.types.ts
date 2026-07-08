import type { PluginManifestDiscoveryResult } from "../plugin-platform.types";

/**
 * Options for the manifest discovery service.
 */
export interface PluginManifestDiscoveryOptions {
  /** Directories to scan for plugin manifest files. */
  readonly directories: string[];
  /** Glob pattern to match manifest files (default: 'plugin.json'). */
  readonly filePattern: string;
  /** Whether to recursively scan subdirectories. */
  readonly recursive: boolean;
}

/**
 * Error encountered while reading a manifest file.
 */
export interface ManifestReadError {
  /** The path of the file that failed to read. */
  readonly filePath: string;
  /** The error message. */
  readonly message: string;
}

/**
 * Aggregated result from a manifest discovery scan.
 */
export interface PluginManifestDiscoveryScanResult {
  /** Successfully discovered and validated manifests. */
  readonly manifests: PluginManifestDiscoveryResult[];
  /** Errors encountered during the scan (e.g., unreadable files, directories). */
  readonly errors: ManifestReadError[];
  /** Total number of directories scanned. */
  readonly directoriesScanned: number;
  /** Total number of manifest files found. */
  readonly filesFound: number;
  /** Timestamp when the scan was performed. */
  readonly scannedAt: Date;
}
