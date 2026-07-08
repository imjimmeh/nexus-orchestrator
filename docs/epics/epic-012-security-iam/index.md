# Epic 012: Security, IAM & Network Isolation

## Overview

**Epic ID**: 012
**Layer**: Advanced Features
**Status**: Not Started
**Priority**: Critical for Production (P0)
**Estimated Timeline**: 1 week

## Context

Implement production-grade security controls including cascading IAM policies, tool access control enforcement, secret management, network isolation for containers, and comprehensive audit logging. This epic hardens the Nexus platform for production use by enforcing the principle of least privilege, preventing unauthorized access, and ensuring all security-sensitive actions are logged.

Security is the final gate before production deployment - this epic ensures Nexus is safe to run in production environments.

## Dependencies

**Upstream Dependencies**:

- Epic 004 (Tool Registry) - for tool access control
- Epic 003 (Docker Orchestration) - for network isolation
- Epic 002 (Core Infrastructure) - for database and logging

**Downstream Dependencies**: None (this hardens existing infrastructure)

## Scope

### Included in This Epic

- **Cascading IAM Policy Engine**
  - Agent profile → tool access mapping
  - Tier-based restrictions (Light, Heavy, Admin)
  - Role-based access control (RBAC) for API users
  - Policy evaluation at runtime

- **Tool Access Control Enforcement**
  - Don't mount unauthorized tools to containers
  - Runtime validation (verify tool is in allowed list)
  - Deny-by-default policy (whitelist only)

- **Secret Management Service**
  - Ephemeral environment variable injection
  - Secret rotation support
  - Integration with Vault or AWS Secrets Manager
  - Never persist secrets to disk or logs

- **Network Isolation Controls**
  - --network none by default for Heavy containers
  - Conditional network access (only when network tools are needed)
  - Whitelist-based egress filtering (allow specific domains only)
  - Block all internet access by default

- **Audit Logging**
  - Log all tool executions with timestamps and agent ID
  - Log all workflow state transitions
  - Log all authentication/authorization failures
  - Tamper-proof audit trail (append-only table)
  - Log retention policy (keep for 90 days)

- **Security Scanning & Validation**
  - Scan session.jsonl for secrets before storage
  - Validate all YAML workflow definitions for injection attacks
  - Scan container images for vulnerabilities
  - Rate limiting on API endpoints (already in Epic 009, enhance here)

### Out of Scope

- Penetration testing (separate security audit)
- Compliance certifications (SOC2, HIPAA)
- Advanced threat detection (SIEM integration)
- Container runtime security (Falco, etc.)
- Kubernetes-specific security (future)

## Tasks

### IAM Policy Engine

- [ ] Create IAMPolicyService
- [ ] Define agent profiles
  - junior_dev: Light tier, limited tools (read, write)
  - senior_dev: Heavy tier, dev tools (bash, git_commit, git_push)
  - qa_automation: Heavy tier, test tools (bash, read)
  - staff_engineer: Admin tier, all tools + spawn_subagent
  - devops_agent: Admin tier, deployment tools (git_push, deploy)
- [ ] Implement profile → tool mapping
  - Load from configuration file (profiles.yaml)
  - Store in database (AgentProfiles table)
  - Cache in memory for performance
- [ ] Implement evaluateAccess(profile, tool) method
  - Check if profile allows tool
  - Return boolean (allow/deny)
  - Log all denials for audit
- [ ] Test policy evaluation with various profiles

### Tool Access Control Enforcement

- [ ] Integrate with ToolMountingService (Epic 004)
  - Before mounting tools, call IAMPolicyService.evaluateAccess()
  - Only mount tools allowed by agent profile
  - Log all mount decisions (allowed/denied)
- [ ] Implement runtime validation
  - When agent attempts to use tool, validate against profile
  - Reject unauthorized tool use (return error to agent)
  - Log unauthorized access attempts
- [ ] Add deny-by-default policy
  - If tool not in allowed list, deny
  - No implicit tool access (explicit whitelist only)
- [ ] Test access control
  - junior_dev cannot access git_push
  - qa_automation cannot access spawn_subagent
  - staff_engineer can access all tools

### Secret Management Service

- [ ] Create SecretManagerService
- [ ] Implement Vault integration (optional)
  - Install vault client library
  - Configure Vault connection (VAULT_ADDR, VAULT_TOKEN)
  - Implement getSecret(key) method
  - Implement rotateSecret(key) method
- [ ] Implement environment variable injection
  - Inject secrets as env vars during container creation
  - Never write secrets to volumes or session.jsonl
  - Never log secret values
- [ ] Implement secret rotation
  - Periodic rotation (every 30 days)
  - On-demand rotation (manual trigger)
  - Update all active containers with new secrets
- [ ] Add secret validation
  - Reject weak secrets (< 32 characters)
  - Enforce secret format (API keys, etc.)
- [ ] Test secret management
  - Secrets injected correctly
  - Secrets not logged
  - Secrets not in session.jsonl

### Session.jsonl Secret Scanning

- [ ] Create SecretScannerService
- [ ] Implement scanForSecrets(jsonl) method
  - Scan for common secret patterns:
    - API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)
    - AWS credentials (AWS_ACCESS_KEY_ID)
    - Private keys (BEGIN PRIVATE KEY)
    - Passwords (password=, pwd=)
  - Use regex patterns
  - Return list of potential secrets found
- [ ] Integrate with SessionHydrationService (Epic 006)
  - Before storing session.jsonl, scan for secrets
  - If secrets found, redact them
  - Log warning (session contained secrets)
- [ ] Add secret redaction
  - Replace secret values with [REDACTED]
  - Preserve JSONL structure
- [ ] Test secret scanning
  - Detect API keys in JSONL
  - Detect private keys
  - Redact secrets before storage

### Network Isolation

- [ ] Modify ContainerOrchestratorService (Epic 003)
  - Add --network none by default for Heavy containers
  - Light containers: bridge network (minimal attack surface)
  - Heavy containers: no network (offline by default)
- [ ] Implement conditional network access
  - If agent uses network tools (curl, wget, http calls), enable network
  - Detect network tools in mounted tools list
  - Enable network only if needed
- [ ] Implement egress filtering (Docker network policies)
  - Whitelist specific domains (e.g., api.openai.com)
  - Block all other egress traffic
  - Use Docker network plugin or iptables
- [ ] Test network isolation
  - Heavy container without network tools: no network access
  - Heavy container with curl: network enabled
  - Egress filtering blocks unauthorized domains

### Audit Logging

- [ ] Create AuditLogService
- [ ] Create AuditLogs table
  - Columns:
    - id (PK)
    - event_type (ToolExecution, WorkflowTransition, AuthFailure, etc.)
    - actor_id (agent ID, user ID)
    - resource_id (workflow_run_id, tool_id)
    - action (executed, transitioned, denied)
    - result (success, failure)
    - metadata (JSONB - additional context)
    - timestamp
  - Make table append-only (no UPDATE or DELETE)
- [ ] Implement logAuditEvent(type, actor, resource, action, result, metadata) method
  - Insert into AuditLogs table
  - Never update or delete records
- [ ] Integrate audit logging across services
  - Log all tool executions (from pi-runner.ts)
  - Log all workflow state transitions (from WorkflowEngine)
  - Log all authentication failures (from JwtAuthGuard)
  - Log all authorization denials (from IAMPolicyService)
- [ ] Implement log retention policy
  - Keep logs for 90 days
  - Archive old logs to S3 or cold storage
  - Background job (runs daily)
- [ ] Test audit logging
  - Tool execution logged
  - Workflow transition logged
  - Auth failure logged
  - Logs are append-only (cannot be modified)

### YAML Injection Prevention

- [ ] Create YAMLValidationService
- [ ] Implement validateYAML(yamlString) method
  - Parse YAML safely (js-yaml with safeLoad)
  - Detect malicious patterns:
    - Code execution attempts (eval, Function)
    - File system access (readFile, writeFile in YAML)
    - Environment variable access (process.env)
  - Return validation errors
- [ ] Integrate with WorkflowEngineService (Epic 005)
  - Validate all YAML on workflow creation
  - Reject malicious YAML (return 400 Bad Request)
- [ ] Test YAML validation
  - Reject YAML with code execution
  - Reject YAML with file system access
  - Accept valid YAML

### Container Image Scanning

- [ ] Implement container image vulnerability scanning
  - Use Docker Scout or Trivy
  - Scan Light and Heavy images
  - Detect critical vulnerabilities (CVEs)
- [ ] Add scanning to CI/CD pipeline
  - Scan images before publishing
  - Fail build if critical vulnerabilities found
- [ ] Document vulnerability remediation process
  - Update base images
  - Rebuild and re-scan
- [ ] Test image scanning
  - Run Trivy on Light and Heavy images
  - Verify no critical vulnerabilities

### API Security Enhancements

- [ ] Enhance rate limiting (from Epic 009)
  - Per-user rate limiting (not just per-IP)
  - Different limits for different endpoints
  - Workflow execution: 10/minute
  - Tool creation: 5/minute
  - Webhooks: 100/minute
- [ ] Add request size limits
  - Max request body: 10MB
  - Max YAML size: 1MB
  - Reject oversized requests
- [ ] Add CORS security
  - Whitelist specific origins only
  - Block all other origins
  - Don't allow wildcard (\*)
- [ ] Test API security
  - Rate limiting enforced
  - Oversized requests rejected
  - CORS blocks unauthorized origins

### Testing & Documentation

- [ ] Write unit tests for IAMPolicyService
- [ ] Write unit tests for SecretScannerService
- [ ] Write unit tests for YAMLValidationService
- [ ] Write integration tests for access control
  - junior_dev denied admin tools
  - staff_engineer allowed all tools
- [ ] Write integration tests for secret management
  - Secrets injected correctly
  - Secrets not leaked
- [ ] Write integration tests for network isolation
  - Containers without network have no internet
  - Containers with network access can connect
- [ ] Write integration tests for audit logging
  - All events logged
  - Logs cannot be modified
- [ ] Document IAM policies and profiles
- [ ] Document secret management process
- [ ] Create security runbook for incidents
- [ ] Create security audit checklist

## Key Deliverables

1. **IAM Policy Engine**
   - Agent profile definitions
   - Tool access control
   - Runtime policy evaluation

2. **Tool Access Control**
   - Mount-time enforcement
   - Runtime validation
   - Deny-by-default policy

3. **Secret Management**
   - Vault integration
   - Ephemeral injection
   - Secret rotation

4. **Network Isolation**
   - --network none by default
   - Conditional network access
   - Egress filtering

5. **Audit Logging**
   - Comprehensive event logging
   - Append-only audit trail
   - Log retention policy

6. **Security Scanning**
   - Session.jsonl secret scanning
   - YAML injection prevention
   - Container image vulnerability scanning

7. **Documentation**
   - IAM policy guide
   - Secret management guide
   - Security runbook

## Acceptance Criteria

- [ ] QA agent profile cannot access merge_pr tool
- [ ] junior_dev profile cannot access spawn_subagent tool
- [ ] staff_engineer profile can access all tools
- [ ] Unauthorized tool access is blocked at mount time
- [ ] Unauthorized tool execution is blocked at runtime (returns error)
- [ ] All access denials are logged in AuditLogs table
- [ ] Secrets are injected as environment variables only (never files)
- [ ] session.jsonl files do not contain secrets (validated via scan)
- [ ] Secret scanner detects API keys, private keys, passwords
- [ ] Detected secrets are redacted before storage
- [ ] Heavy containers launch with --network none by default
- [ ] Network is enabled only when network tools are mounted
- [ ] Containers without network cannot access internet (tested with curl)
- [ ] Egress filtering blocks unauthorized domains (tested with curl)
- [ ] Secret rotation works without restarting containers
- [ ] All tool executions are logged in AuditLogs table
- [ ] All workflow transitions are logged
- [ ] All authentication failures are logged
- [ ] AuditLogs table is append-only (UPDATE/DELETE blocked)
- [ ] YAML injection attempts are detected and rejected
- [ ] Malicious YAML (with code execution) is rejected
- [ ] Container images have no critical vulnerabilities (Trivy scan passes)
- [ ] API rate limiting is per-user (not just per-IP)
- [ ] Oversized requests (> 10MB) are rejected
- [ ] CORS blocks unauthorized origins
- [ ] Unit tests verify IAM policy evaluation (80%+ coverage)
- [ ] Integration tests verify end-to-end access control
- [ ] Security scan passes (no secrets leaked, no vulnerabilities)

## Technical Notes

### Technology Stack

- **Secret Management**: Vault (optional) or AWS Secrets Manager
- **Container Security**: Docker --network none, iptables
- **Secret Scanning**: Custom regex patterns
- **Image Scanning**: Trivy or Docker Scout
- **YAML Parsing**: js-yaml (safeLoad)

### Agent Profile Example

```yaml
# profiles.yaml
profiles:
  junior_dev:
    tier: Light
    tools:
      - read
      - write
      - edit

  senior_dev:
    tier: Heavy
    tools:
      - read
      - write
      - edit
      - bash
      - git_commit
      - git_push

  staff_engineer:
    tier: Admin
    tools:
      - "*" # All tools
```

### Secret Scanner Patterns

```typescript
const SECRET_PATTERNS = [
  /OPENAI_API_KEY["\s:=]+([a-zA-Z0-9-_]+)/i,
  /ANTHROPIC_API_KEY["\s:=]+([a-zA-Z0-9-_]+)/i,
  /AWS_ACCESS_KEY_ID["\s:=]+([A-Z0-9]+)/i,
  /-----BEGIN (RSA |)PRIVATE KEY-----/i,
  /password["\s:=]+([^\s"]+)/i,
  /api[_-]?key["\s:=]+([a-zA-Z0-9-_]+)/i,
];
```

### Network Isolation Example

```javascript
// Disable network by default
const containerConfig = {
  HostConfig: {
    NetworkMode: "none", // No network access
  },
};

// Enable network if needed
if (hasNetworkTools(tools)) {
  containerConfig.HostConfig.NetworkMode = "bridge";
  containerConfig.HostConfig.Dns = ["8.8.8.8"]; // Only allow specific DNS
}
```

### Audit Log Entry Example

```json
{
  "id": "audit_123",
  "event_type": "ToolExecution",
  "actor_id": "agent_456",
  "resource_id": "tool_bash",
  "action": "executed",
  "result": "success",
  "metadata": {
    "command": "npm test",
    "exit_code": 0,
    "duration_ms": 5432
  },
  "timestamp": "2026-03-22T10:30:00Z"
}
```

### Security Checklist

- [ ] All secrets injected as env vars (not files)
- [ ] No secrets in session.jsonl
- [ ] No secrets in logs
- [ ] Container images scanned for vulnerabilities
- [ ] YAML validated for injection attacks
- [ ] Network isolation enforced
- [ ] Tool access control enforced
- [ ] All security events logged
- [ ] Audit logs are tamper-proof

### Security Considerations

- **Defense in Depth**: Multiple layers of security (IAM, network, secrets)
- **Least Privilege**: Deny-by-default, whitelist only
- **Audit Everything**: Comprehensive logging for forensics
- **Secret Zero**: Never persist secrets to disk
- **Network Isolation**: Block all network by default

### Testing Strategy

- **Unit Tests**: Policy evaluation, secret scanning, YAML validation
- **Integration Tests**: Access control, network isolation, audit logging
- **Security Tests**: Penetration testing, secret leakage tests
- **Compliance Tests**: Verify all controls are enforced

## Risks & Mitigation

| Risk                         | Impact   | Probability | Mitigation                                       |
| ---------------------------- | -------- | ----------- | ------------------------------------------------ |
| Secret leakage to logs/JSONL | Critical | Medium      | Secret scanning, validation, testing             |
| IAM policy bypass            | Critical | Low         | Multiple enforcement layers, comprehensive tests |
| Network isolation bypass     | High     | Low         | Container runtime enforcement, monitoring        |
| Audit log tampering          | Medium   | Low         | Append-only table, database permissions          |
| YAML injection attacks       | High     | Medium      | Safe YAML parsing, input validation              |

## Parallel Development

**Can Run in Parallel**: PARTIAL (after Epic 003 + Epic 004 complete)
**Can Run Alongside**: Epic 013 (Observability)

## Related ADRs

- Create ADR-033: Secret management strategy (Vault vs. AWS Secrets Manager)
- Create ADR-034: Network isolation approach (--network none vs. firewall)
- Create ADR-035: Audit log retention policy (90 days)

## Notes

- Security is critical - allocate full week for implementation and testing
- Test thoroughly - security bugs are unacceptable
- Secret scanning is essential - one leaked key compromises everything
- Network isolation prevents most supply chain attacks
- Audit logging is required for compliance and forensics
- Consider third-party security audit before production deployment
- Document all security controls for compliance teams
- Security is never "done" - plan for ongoing improvements
