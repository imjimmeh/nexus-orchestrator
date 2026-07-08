// packages/gitops-contracts/src/common.schema.types.ts

/** A scope node address by slug path. "/" is the platform root; otherwise a
 * leading-slash chain of slugs (e.g. "/acme/emea/platform-team"). UUIDs never
 * appear in paths — the repo is human-addressed.
 */
export type ScopePath = string;
