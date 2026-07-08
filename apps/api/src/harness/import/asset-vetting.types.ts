/**
 * Discriminant codes for vetting rejection reasons.
 *
 * Used by `VettingError` and exposed to callers for typed error handling.
 */
export type VettingErrorCode =
  /** CC plugin: `.claude-plugin/plugin.json` not found in the fetched tree. */
  | 'cc_manifest_missing'
  /** CC plugin: `.claude-plugin/marketplace.json` detected — v1 rejects marketplace imports. */
  | 'cc_marketplace_rejected'
  /** CC plugin: `.claude-plugin/plugin.json` content is not valid JSON. */
  | 'cc_manifest_invalid_json'
  /** CC plugin: `plugin.json` has no `name` field (required). */
  | 'cc_manifest_name_missing'
  /** CC plugin: `plugin.json` `name` field does not match kebab-case. */
  | 'cc_manifest_name_invalid'
  /** PI extension: `package.json` detected — v1 rejects packaged / multi-file extensions. */
  | 'pi_package_rejected'
  /** PI extension: no root-level `.ts` file found. */
  | 'pi_no_ts_entry'
  /** PI extension: more than one root-level `.ts` file — v1 requires exactly one. */
  | 'pi_multi_file_rejected'
  /** PI extension: entry `.ts` has no `export default` — factory is missing. */
  | 'pi_no_default_export'
  /** Total fetched bytes exceed the configured size cap. */
  | 'size_cap_exceeded'
  /** Source repo URL or package name is on the configured denylist. */
  | 'source_denylisted'
  /** CC plugin: `hooks/hooks.json` is present but cannot be parsed as JSON. */
  | 'cc_hooks_invalid_json'
  /** CC plugin: `hooks/hooks.json` contains an entry whose SDK hook event is not mappable to a neutral event. */
  | 'cc_hooks_unknown_event'
  /**
   * CC plugin: the fetched tree contains a component that v1 cannot faithfully import.
   * The `message` field names the offending component (e.g. `commands/`, `.mcp.json`).
   */
  | 'cc_unsupported_component';

/**
 * Structured error returned by vetting helpers when a fetch is rejected.
 */
export interface VettingError {
  code: VettingErrorCode;
  message: string;
}

/**
 * Discriminated result returned by vetting helpers.
 *
 * On success `ok` is `true` and `value` carries the validated data.
 * On failure `ok` is `false` and `error` describes the rejection.
 */
export type VettingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VettingError };
