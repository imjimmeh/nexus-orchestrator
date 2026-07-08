/**
 * Type exports for contribution-extension-staging.ts.
 * Extracted into a dedicated *.types.ts file per the project's lint rules.
 */

/** Diagnostic emitted when an extension asset cannot be staged. */
export interface DroppedExtension {
  id: string;
  name: string;
  reason:
    | "checksum_mismatch"
    | "missing_bundle"
    | "missing_source"
    | "package_runtime_deferred"
    | "stage_write_failed";
}

/** Result of a staging pass: staged file paths + any dropped extensions. */
export interface ExtensionStagingResult {
  stagedPaths: string[];
  dropped: DroppedExtension[];
}
