---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: oauth
outcome: failed
inferred_status: unknown
confidence_score: 0
evidence_refs:
  - apps/api/src/oauth/anthropic-oauth.provider.ts
  - apps/api/src/oauth/oauth-login.service.ts
  - apps/api/src/oauth/oauth-login.types.ts
  - apps/api/src/oauth/oauth.module.ts
  - apps/api/src/oauth/pi-ai-oauth-provider.resolver.ts
source_paths:
  - apps/api/src/oauth
updated_at: 2026-06-15T17:50:00.000Z
---

# Probe Result: OAuth Provider Login (FAILED)

## Narrative Summary

The probe for the `oauth` scope **failed** during execution. The source directory
`apps/api/src/oauth/` exists and contains an implementation (`anthropic-oauth.provider.ts`,
`oauth-login.service.ts`, `oauth-login.types.ts`, `oauth.module.ts`,
`pi-ai-oauth-provider.resolver.ts`, plus 3 spec files), but the probe subagent
that was supposed to investigate this scope was unable to complete its work and
write a structured probe result to disk.

**Error summary:**

- The probe subagent that was supposed to investigate the oauth scope did not
  successfully complete its write step.
- This scope was previously recorded as `failed` in `state.probe_results` and
  was skipped during the recovery pass; however, no failure artifact was
  actually written to disk.
- The previous job's recovery claim ("All 49 manifest scope probe result files
  exist on disk") was incorrect; this scope is one of five where the file is
  missing.
- The source code does exist. The capability described in the manifest
  (anthropic-oauth.provider, oauth-login.service, pi-ai-oauth-provider.resolver)
  is structurally present, but no first-hand probe narrative can be produced
  without re-running the investigation.
- Recommended remediation: re-probe this scope in the next investigation cycle.

The OAuth capability is described in the manifest as implementing the OAuth
code grant flow at the API tier.
