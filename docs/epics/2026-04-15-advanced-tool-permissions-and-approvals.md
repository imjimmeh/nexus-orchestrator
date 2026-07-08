# Epic: Advanced Tool Permissions & Human Approvals

**Plan:** `docs/plans/2026-04-15-advanced-tool-permissions-and-approvals-design.md`  
**Implementation Plan:** `docs/plans/2026-04-15-advanced-tool-permissions-and-approvals.md`  
**Created:** 2026-04-15  
**Status:** In Progress

---

## Overview

Implement a comprehensive tool permission and human approval system for the Nexus Orchestrator, enabling argument-level restrictions, persistent approval rules, Telegram/chat inline approvals, and extended agent profile configurations.

---

## Objectives

1. Enable fine-grained tool permissions based on tool arguments (prefix, glob, regex, equality)
2. Allow humans to approve tool usage with "always allow" semantics that persist as rules
3. Surface runtime tool-call approvals in the web UI and Telegram/chat
4. Extend agent profile DTOs/entities/seeds to support `denied_tools` and `approval_required_tools`
5. Ensure subagent dispatch can be restricted by the same argument-level permission engine
6. Maintain backward compatibility with existing permission layers

---

## Key Deliverables

- [ ] `tool_approval_rules` database table and entity
- [ ] `tool_call_approval_requests` database table and entity
- [ ] `ToolApprovalRuleService` with argument pattern matching
- [ ] `ToolCallApprovalRequestService` with blocking/waiting logic
- [ ] Integration with `CapabilityPreflightService`
- [ ] Integration with `WorkflowRuntimeCapabilityExecutorService`
- [ ] `ToolCallApprovalRequestsController` REST API
- [ ] Telegram inline keyboard notifications and callback handlers
- [ ] Frontend Notifications panel for tool call approvals
- [ ] Workflow Editor support for `approval_required_tools`
- [ ] Agent Profile admin UI for `denied_tools` and `approval_required_tools`
- [ ] Agent profile seed updates
- [ ] End-to-end integration tests
- [ ] All tests passing

---

## Architecture

- **Orchestration-level action requests** (`ProjectOrchestrationActionRequest`) remain unchanged
- **New `ToolCallApprovalRequest` entity** handles mid-execution agent tool calls
- **New `tool_approval_rules` table** stores persistent allow/deny/approval_required rules
- **`ToolApprovalRuleService`** evaluates rules at preflight and execution time
- **Telegram and Web UI** receive notifications with inline approval options

---

## Related Files

### Backend
- `apps/api/src/database/migrations/20260415000000-create-tool-approval-rules.ts`
- `apps/api/src/database/migrations/20260415000001-create-tool-call-approval-requests.ts`
- `apps/api/src/database/migrations/20260415000002-add-agent-profile-denied-approval-tools.ts`
- `apps/api/src/database/entities/tool-approval-rule.entity.ts`
- `apps/api/src/database/entities/tool-call-approval-request.entity.ts`
- `apps/api/src/database/repositories/tool-approval-rule.repository.ts`
- `apps/api/src/database/repositories/tool-call-approval-request.repository.ts`
- `apps/api/src/tool/tool-approval-rule.service.ts`
- `apps/api/src/tool/tool-call-approval-request.service.ts`
- `apps/api/src/tool/tool-call-approval-requests.controller.ts`
- `apps/api/src/tool/capability-preflight.service.ts`
- `apps/api/src/workflow/workflow-runtime-capability-executor.service.ts`
- `apps/api/src/workflow/step-support.service.ts`
- `apps/chat/src/channel-adapters/telegram/telegram-tool-approval.handler.ts`

### Frontend
- `apps/web/src/pages/Notifications.tsx`
- `apps/web/src/pages/workflows/WorkflowEditor.tsx`
- `apps/web/src/lib/api/types.ts`
- `apps/web/src/lib/api/client.ts`

### Seeds
- `seed/agents/*/agent.json`
- `apps/api/src/database/seeds/agent-profiles/`

