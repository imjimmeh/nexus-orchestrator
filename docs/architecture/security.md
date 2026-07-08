# Security, IAM & Network Isolation

Nexus implements production-grade security controls to ensure AI agents operate within safe boundaries and sensitive data is protected.

## Architecture

1. **`IAMPolicyService`**
   - Cascading IAM policy engine that maps agent profiles to specific tool sets and resource tiers.
   - **Deny-by-default**: Tools must be explicitly whitelisted for a profile.
   - **Profiles**: `junior_dev`, `senior_dev`, `qa_automation`, `staff_engineer`.

2. **`AuditLogService`**
   - Append-only tamper-proof audit trail stored in PostgreSQL.
   - Logs all security events: tool executions, workflow transitions, auth failures, and policy denials.
   - Retention: 90 days.

3. **`SecretScannerService`**
   - Scans all session data (`session.jsonl`) for potential secrets (API keys, passwords, private keys) using high-entropy regex patterns.
   - **Redaction**: Automatically replaces secrets with `[REDACTED]` before they hit the persistence layer.

4. **`YAMLValidationService`**
   - Prevents YAML injection attacks by scanning workflow definitions for malicious code patterns (`eval`, `process.env`) before parsing.

5. **`SecretManagerService`**
   - Manages ephemeral injection of secrets into agent containers via environment variables.
   - Ensures secrets are never written to disk or logs.

## Network Isolation

- **Heavy Containers**: Launch with `--network none` by default.
- **Conditional Access**: Network is only enabled if the agent's assigned tools explicitly require it (e.g., `git_push`).
- **Egress Filtering**: Whitelist-based egress control (Future enhancement).

## Unified Authorization Guard

API authorization uses a single, permission-based guard model. All
controller routes are protected by `PermissionsGuard` together with the
`@RequirePermission(...)` decorator (see [19 — Security § Unified
Authorization Guard](../guide/19-security.md#unified-authorization-guard)
for the full model, decorator usage, role-to-permission helper, and
migration notes). Roles are no longer used as an authorization primitive at
the HTTP boundary; they are an internal grouping mechanism for assigning
permissions to users.

## Security Checklist

- [x] JWT Authentication for REST and WebSocket.
- [x] Permission-Based Access Control (PBAC) via `@RequirePermission` + `PermissionsGuard`.
- [x] Per-profile tool access enforcement.
- [x] Secret scanning and redaction in sessions.
- [x] Safe YAML parsing.
- [x] Append-only audit logs.
- [x] Container resource limits and isolation.
