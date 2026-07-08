/**
 * Behaviour-change anchor derived from a promoted lesson's
 * `metadata_json` at inject time (EPIC-212 Phase 3, Task 1).
 *
 * An anchor records the *concrete code-level subject* of a
 * promoted lesson so a later measurement pass can ask "after
 * this lesson was injected into the planning context, did the
 * run actually exercise the anchored tool / path?". Both legs
 * are optional: a lesson with no resolvable anchor yields `{}`
 * and behaves exactly as it did before this capture existed.
 *
 * - `tool` — the name of a runtime tool the lesson is about
 *   (e.g. derived from a `tool` / `tool_name` evidence field).
 * - `path` — a file / code path the lesson anchors (e.g. a
 *   drift-checkable `filePath`, a `drift_reference` of kind
 *   `file`, or a `path` field on an evidence entry).
 *
 * The shape is deliberately neutral — it carries no domain
 * identifiers and is reused by the drift-reference attachment
 * (Phase 3 Task 4) and the behaviour-change matcher
 * (Phase 3 Task 6).
 */
export interface LessonAnchor {
  tool?: string;
  path?: string;
}
