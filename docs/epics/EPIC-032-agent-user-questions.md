# EPIC-032: Agent "Ask User Questions" Feature

## Status

**Completed** — All 8 phases implemented and committed.

| Phase | Description                                     | Status      |
| ----- | ----------------------------------------------- | ----------- |
| 1     | Global System Settings (Backend)                | ✅ Complete |
| 2     | Pi-Runner Bridge Tool + WebSocket Command       | ✅ Complete |
| 3     | API Backend — Telemetry Gateway + REST Endpoint | ✅ Complete |
| 4     | Container Idle Lifecycle (Dehydrate-on-Idle)    | ✅ Complete |
| 5     | Kanban "Awaiting Input" Badge                   | ✅ Complete |
| 6     | Web Frontend — Question Card UI                 | ✅ Complete |
| 7     | Global Work Items Page                          | ✅ Complete |
| 8     | Global Settings Page (Frontend)                 | ✅ Complete |

## Summary

Enable agents to ask users structured questions with up to 3 predefined answer options plus an optional free-text input. Questions are delivered as an interactive card in the active session UI. The system gracefully manages container lifecycle while waiting for user responses, provides kanban board visibility for tasks awaiting input, and adds cross-project work item filtering.

## Motivation

Currently, agents have no way to solicit user input during execution. When an agent encounters ambiguity or needs a decision, it must either guess or fail. This blocks common workflows where human-in-the-loop decisions are essential (e.g., choosing an implementation approach, selecting a dependency, confirming destructive actions).

### User Outcomes

1. **Agents can ask structured questions** — up to 3 predefined options per question, plus optional free-text, any number of questions per request.
2. **No wasted compute** — containers dehydrate after configurable idle periods; no error is raised for slow human responses.
3. **Clear kanban visibility** — an "Awaiting Input" badge on the board makes it immediately obvious which tasks need human attention.
4. **Cross-project work item view** — a global page lets users filter all work items by status, including "awaiting input", so nothing is missed.
5. **Configurable timeouts** — platform-wide settings control dehydrate and removal timers.

## Phases

### Phase 1: Global System Settings (Backend)

New `system_settings` key-value entity and module for platform-wide configuration.

| Task | File(s)                                  | Description                                                           |
| ---- | ---------------------------------------- | --------------------------------------------------------------------- |
| 1.1  | `entities/system-setting.entity.ts`      | Create SystemSetting entity (key/value/description)                   |
| 1.2  | `settings/system-settings.service.ts`    | CRUD service with typed `get<T>()` and `set()`                        |
| 1.3  | `settings/system-settings.controller.ts` | `GET /api/system-settings`, `PUT /api/system-settings/:key` (admin)   |
| 1.4  | `settings/system-settings.module.ts`     | NestJS module, register entity, export service                        |
| 1.5  | `database/database.module.ts`            | Register entity in entities array                                     |
| 1.6  | `app.module.ts`                          | Import SystemSettingsModule                                           |
| 1.7  | Seed default settings                    | `question_idle_stop_seconds=300`, `question_idle_remove_seconds=3600` |
| 1.8  | Unit tests                               | Service get/set/getAll, controller endpoints                          |

### Phase 2: Pi-Runner — Bridge Tool + WebSocket Command

New `ask_user_questions` bridge tool, no timeout on runner side.

| Task | File(s)                  | Description                                                 |
| ---- | ------------------------ | ----------------------------------------------------------- |
| 2.1  | `orchestrator-client.ts` | Add `question_response` command type                        |
| 2.2  | `nexus-bridge-tools.ts`  | Create `ask_user_questions` tool definition with validation |
| 2.3  | `nexus-bridge-tools.ts`  | Tool blocks until `question_response` command arrives       |
| 2.4  | `nexus-bridge-tools.ts`  | Export from `createNexusBridgeTools()` array                |
| 2.5  | Unit tests               | Validation, happy-path answer resolution                    |

### Phase 3: API Backend — Telemetry Gateway + REST Endpoint

Handle question events, forward answers, manage state.

| Task | File(s)                              | Description                                         |
| ---- | ------------------------------------ | --------------------------------------------------- |
| 3.1  | `telemetry.gateway.ts`               | `@SubscribeMessage('user_questions_posed')` handler |
| 3.2  | `telemetry.gateway.ts`               | `sendQuestionResponseCommand()` method              |
| 3.3  | `dto/submit-question-answers.dto.ts` | DTO with class-validator decorators                 |
| 3.4  | `workflow-run-steering.service.ts`   | `submitQuestionAnswers()` method                    |
| 3.5  | `workflow.controller.ts`             | `POST /workflows/runs/:runId/question-answers`      |
| 3.6  | Unit tests                           | Event handling, command forwarding, DTO validation  |

### Phase 4: Container Idle Lifecycle (Dehydrate-on-Idle)

Two-tier configurable idle timeout: stop container, then remove.

| Task | File(s)                            | Description                                             |
| ---- | ---------------------------------- | ------------------------------------------------------- |
| 4.1  | `question-idle-tracker.service.ts` | Service with startIdleTimers/cancelIdleTimers           |
| 4.2  | `telemetry.gateway.ts`             | Start timers on `user_questions_posed`                  |
| 4.3  | `workflow-run-steering.service.ts` | Cancel timers on answer submission; rehydrate if needed |
| 4.4  | Unit tests                         | Timer lifecycle, cancel-before-fire                     |

### Phase 5: Kanban "Awaiting Input" Badge

DB flag and UI badge for work items waiting on user input.

| Task | File(s)               | Description                                                                    |
| ---- | --------------------- | ------------------------------------------------------------------------------ |
| 5.1  | `work-item.entity.ts` | Add `waitingForInput` boolean column                                           |
| 5.2  | API handlers          | Set/clear flag on questions posed / answers submitted                          |
| 5.3  | `types.ts` (web)      | Add `"awaiting-input"` to `WorkItemLiveState`, `waitingForInput` to `WorkItem` |
| 5.4  | `kanban.utils.ts`     | Update `deriveLiveState()`                                                     |
| 5.5  | `KanbanBoard.tsx`     | Add orange badge class                                                         |
| 5.6  | `workspace.utils.ts`  | Update `deriveSessionSummary()`                                                |
| 5.7  | Unit tests            | deriveLiveState, deriveSessionSummary with new state                           |

### Phase 6: Web Frontend — Question Card UI

Interactive question card in the active session chat.

| Task | File(s)                      | Description                                                     |
| ---- | ---------------------------- | --------------------------------------------------------------- |
| 6.1  | `active-session.utils.ts`    | Extend `SessionChatMessage` with `questions` and `questionMeta` |
| 6.2  | `active-session.utils.ts`    | Handle `user_questions_posed` + `user_question_answers` events  |
| 6.3  | `UserQuestionsCard.tsx`      | New component: radio buttons, free-text, submit                 |
| 6.4  | `ActiveSessionWorkspace.tsx` | Wire submit handler                                             |
| 6.5  | `client.ts` (API)            | `submitWorkflowRunQuestionAnswers()` method                     |
| 6.6  | Unit tests                   | Component rendering, event handling                             |

### Phase 7: Global Work Items Page

Cross-project work item list with filtering.

| Task | File(s)                                             | Description                        |
| ---- | --------------------------------------------------- | ---------------------------------- |
| 7.1  | `work-item.controller.ts` / `project.controller.ts` | `GET /api/work-items` with filters |
| 7.2  | `work-item.repository.ts`                           | Cross-project query with joins     |
| 7.3  | `WorkItemsPage.tsx`                                 | Table view with filter bar         |
| 7.4  | `client.ts` (API)                                   | `getGlobalWorkItems()` method      |
| 7.5  | `App.tsx` + `Sidebar.tsx`                           | Route + nav entry                  |
| 7.6  | Unit tests                                          | Filter combinations, rendering     |

### Phase 8: Global Settings Page (Frontend)

Admin UI for system settings.

| Task | File(s)                  | Description                                    |
| ---- | ------------------------ | ---------------------------------------------- |
| 8.1  | `GlobalSettingsPage.tsx` | Settings form with number inputs               |
| 8.2  | `client.ts` (API)        | `getSystemSettings()`, `updateSystemSetting()` |
| 8.3  | `App.tsx`                | Extend settings route                          |
| 8.4  | Unit tests               | Form rendering                                 |

## Non-Goals

- Agent-to-agent questions (only agent-to-human)
- File upload or image-based question responses
- Question branching/conditional follow-up logic within the tool
- Changing workflow execution semantics

## Dependencies

- Existing session hydration infrastructure (Epic 006)
- Existing telemetry gateway WebSocket (Epic 007/018)
- Existing kanban board (Epic 020)
- Existing active session workspace (Epic 022)

## Risks

| Risk                                            | Mitigation                                               |
| ----------------------------------------------- | -------------------------------------------------------- |
| API restart loses in-memory idle timers         | ContainerCleanupService cron catches orphaned containers |
| Long-lived dehydrated sessions consume DB space | Session tree cleanup scheduled separately (existing)     |
| User answers arrive after container removed     | Same rehydration path as stopped — session tree persists |
