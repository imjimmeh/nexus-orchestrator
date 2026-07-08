# EPIC-185: Database Domain Organization

**Status:** Implemented
**Priority:** P2
**Depends On:** None
**Related Epics:** EPIC-123 (Service Decomposition), EPIC-173 (Large Service Decomposition), EPIC-174 (Shared Contracts Validation and Dry Cleanup)
**Last Updated:** 2026-05-16

---

## 1. Summary

The `database/` directory contains 65 entities, 80+ repositories, 70+ migrations, and 40+ seed files — all in one flat structure with no domain-boundary seams. Understanding the "User" domain requires scanning through 185 files. The deletion test fails: deleting the `database/` directory removes everything, with no leverage at any seam because nothing is organized by domain concept.

This epic organizes entities, repositories, and migrations by bounded context, improving locality and making the deletion test pass for each domain.

---

## 2. High-Level Context

### 2.1 Current Structure

```
database/
  entities/                          ← 65 entity files, flat
    user.entity.ts
    user-role.entity.ts
    user-channel-identity.entity.ts
    workflow.entity.ts
    workflow-run.entity.ts
    workflow-event.entity.ts
    tool-registry.entity.ts
    tool-artifact.entity.ts
    chat-session.entity.ts
    chat-message.entity.ts
    agent-profile.entity.ts
    agent-war-room-session.entity.ts
    ... (57 more)
  repositories/                      ← 80+ repo files, flat
    user.repository.ts
    user-role.repository.ts
    workflow.repository.ts
    workflow-run.repository.ts
    tool-registry.repository.ts
    ... (77 more)
  migrations/                        ← 70+ migration files, timestamp-ordered
    1713520800000-add-notification-read-tracking.ts
    20260405000000-create-project-orchestration-action-requests.ts
    ... (69 more)
  seeds/                             ← 40+ seed files, flat
    agent-profiles.seed.ts
    llm-models.seed.ts
    skills.seed.ts
    tool-approval-rules.seed.ts
    workflows.seed.ts
    ... (36 more)
```

### 2.2 Entity Distribution by Domain

| Domain       | Entities                                                                                                                                                    | Repositories |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| User/Auth    | 5 (user, user-role, user-channel-identity, refresh-token, permission)                                                                                       | 5            |
| Workflow     | 8 (workflow, workflow-run, workflow-event, workflow-launch-preset, workflow-run-todo, subagent-execution, delegation-contract, orchestration-session-state) | 8            |
| Tool         | 5 (tool-registry, tool-artifact, tool-validation-run, tool-approval-rule, tool-call-approval-request)                                                       | 5            |
| Chat         | 4 (chat-session, agent-communication-thread, agent-communication-message, chat-channel-route)                                                               | 4            |
| War Room     | 7 (war-room-session, war-room-participant, war-room-message, war-room-blackboard, war-room-signoff, agent-war-room-\*)                                      | 5            |
| Agent        | 5 (agent-profile, agent-profile-skill, agent-skill, llm-model, llm-provider)                                                                                | 5            |
| Automation   | 4 (scheduled-job, scheduled-job-run, automation-hook, heartbeat-profile, heartbeat-run, standing-order)                                                     | 6            |
| Memory       | 2 (memory-segment, learning-candidate, skill-improvement-proposal)                                                                                          | 3            |
| MCP          | 1 (mcp-server)                                                                                                                                              | 1            |
| ACP          | 2 (acp-discovered-agent, acp-server)                                                                                                                        | 2            |
| Notification | 1 (notification)                                                                                                                                            | 1            |
| Audit        | 1 (audit-log)                                                                                                                                               | 1            |
| System       | 3 (system-setting, setup-config, cost-tracking)                                                                                                             | 3            |

### 2.3 Current Pain Points

1. **No locality:** All 65 entities are in one flat directory. Finding all user-related entities requires grepping.
2. **Migration navigation:** 70+ migrations in timestamp order make it hard to find migrations for a specific domain.
3. **Seed organization:** 40+ seed files in a flat directory with no domain grouping.
4. **Repository leakage:** Entities and repositories in `database/` are imported directly by services across all modules, bypassing any abstraction layer.
5. **Deletion test fails:** Deleting `database/` removes everything — no domain-level seams exist.

---

## 3. Goals

1. Organize `entities/` by bounded context (10–14 subdirectories).
2. Organize `repositories/` to mirror the entity structure.
3. Group migrations by domain where feasible.
4. Group seeds by domain.
5. Ensure the deletion test passes: deleting `database/entities/user/` removes only user persistence.
6. Zero behavioral changes — this is a pure file reorganization.

---

## 4. Non-Goals

1. No changes to entity definitions, repository methods, or migration logic.
2. No changes to TypeORM configuration or database connection.
3. No introduction of new abstraction layers (repositories stay as-is).
4. No changes to migration naming conventions or execution order.

---

## 5. Implementation Phases

### Phase 1: Plan the New Structure

- **Task E185-001: Create domain-to-file mapping**
  - Map each entity to its domain.
  - Map each repository to its domain.
  - Map each migration to its domain (based on table names).
  - Map each seed to its domain.
  - **Deliverable:** Spreadsheet or markdown table with file → domain mapping.

- **Task E185-002: Create target directory structure**
  ```
  database/
    entities/
      user/           (user.entity.ts, user-role.entity.ts, user-channel-identity.entity.ts, refresh-token.entity.ts, permission.entity.ts)
      workflow/       (workflow.entity.ts, workflow-run.entity.ts, workflow-event.entity.ts, workflow-launch-preset.entity.ts, workflow-run-todo.entity.ts, subagent-execution.entity.ts, delegation-contract.entity.ts, orchestration-session-state.entity.ts)
      tool/           (tool-registry.entity.ts, tool-artifact.entity.ts, tool-validation-run.entity.ts, tool-approval-rule.entity.ts, tool-call-approval-request.entity.ts)
      chat/           (chat-session.entity.ts, agent-communication-thread.entity.ts, agent-communication-message.entity.ts, chat-channel-route.entity.ts)
      war-room/       (agent-war-room-session.entity.ts, agent-war-room-participant.entity.ts, agent-war-room-message.entity.ts, agent-war-room-blackboard.entity.ts, agent-war-room-signoff.entity.ts)
      agent/          (agent-profile.entity.ts, agent-profile-skill.entity.ts, agent-skill.entity.ts, llm-model.entity.ts, llm-provider.entity.ts)
      automation/     (scheduled-job.entity.ts, scheduled-job-run.entity.ts, automation-hook.entity.ts, heartbeat-profile.entity.ts, heartbeat-run.entity.ts, standing-order.entity.ts)
      memory/         (memory-segment.entity.ts, learning-candidate.entity.ts, skill-improvement-proposal.entity.ts)
      mcp/            (mcp-server.entity.ts)
      acp/            (acp-discovered-agent.entity.ts, acp-server.entity.ts)
      notification/   (notification.entity.ts)
      audit/          (audit-log.entity.ts)
      system/         (system-setting.entity.ts, setup-config.entity.ts, cost-tracking.entity.ts)
      web-automation/ (web-automation-failure-artifact.entity.ts)
    repositories/     (mirror structure)
    migrations/       (keep timestamp order but add domain prefix in comments)
    seeds/            (group by domain)
  ```

### Phase 2: Reorganize Entities

- **Task E185-003: Create domain subdirectories**
  - Create `entities/user/`, `entities/workflow/`, `entities/tool/`, etc.

- **Task E185-004: Move entity files**
  - Move each entity file to its domain subdirectory.
  - Update imports within entity files (e.g., `@Entity()` decorators, type imports).
  - Update `entities/index.ts` to re-export from new paths.

- **Task E185-005: Update all cross-module imports**
  - Find all `from '../database/entities/user.entity'` imports.
  - Update to `from '../database/entities/user/user.entity'`.
  - **Scope:** All services, repositories, seeds that import entities.

### Phase 3: Reorganize Repositories

- **Task E185-006: Move repository files**
  - Mirror the entity structure in `repositories/`.
  - Update imports within repository files (entity imports).
  - Update `repositories/index.ts`.

### Phase 4: Reorganize Seeds

- **Task E185-007: Group seeds by domain**
  - Create `seeds/user/`, `seeds/workflow/`, `seeds/tool/`, etc.
  - Move seed files.
  - Update `seeds/index.ts`.

### Phase 5: Verify

- **Task E185-008: Run build and typecheck**
  - `npm run build:api`
  - Verify zero TypeScript errors.

- **Task E185-009: Run lint**
  - `npm run lint:api`
  - Fix any lint findings.

- **Task E185-010: Run tests**
  - `npm run test:api`
  - Verify all tests pass.

- **Task E185-011: Verify deletion test**
  - For each domain subdirectory, verify that deleting it removes only that domain's persistence.

---

## 6. Expected Outcomes

| Metric                                   | Before                 | After                          |
| ---------------------------------------- | ---------------------- | ------------------------------ |
| Entity files in flat `entities/`         | 65                     | 0 (organized into 14 subdirs)  |
| Repository files in flat `repositories/` | 80+                    | 0 (organized into 14 subdirs)  |
| Files to find all user entities          | 65 (scan all)          | 5 (in `entities/user/`)        |
| Deletion test                            | Fails (flat directory) | Passes (domain subdirectories) |

---

## 7. Risk and Mitigation

| Risk                                                                  | Mitigation                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Broken imports in services across all modules                         | Use IDE find-and-replace for common patterns; verify with full build                                   |
| Circular imports between entity files (e.g., workflow ↔ workflow-run) | Keep cross-entity imports working; if needed, extract shared types to a `types/` subdirectory          |
| Migration references to old entity paths                              | Migrations reference table names, not entity paths — no changes needed                                 |
| `entities/index.ts` and `repositories/index.ts` become large          | Consider domain-specific index files (`entities/user/index.ts`) + root index that re-exports from them |
