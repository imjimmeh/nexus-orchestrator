/**
 * Returns true when the SESSION_CHECKPOINT_RESUME_ENABLED env var is set to
 * the string `"true"` or `"1"`.  All other values (including unset) return
 * false so the feature is OFF by default and the branch is safe to merge.
 */
export function isSessionCheckpointResumeEnabled(): boolean {
  const raw = process.env.SESSION_CHECKPOINT_RESUME_ENABLED?.trim();
  return raw === 'true' || raw === '1';
}
