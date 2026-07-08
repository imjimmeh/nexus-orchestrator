# EPIC-183: WorkflowPersistenceService Deepening

**Status:** Implemented
**Priority:** P1
**Depends On:** None
**Related Epics:** EPIC-147 (Workflow Module Decomposition), EPIC-173 (Large Service Decomposition)
**Last Updated:** 2026-05-17

---

## 1. Summary

`WorkflowPersistenceService` (`apps/api/src/workflow/workflow-persistence.service.ts`, 161 lines) mixes workflow catalog persistence with YAML validation, workflow parsing, and workflow validation. It exposes `parser` and `validator` as public fields (lines 14-15), and `WorkflowEngineService` reaches through those fields when starting and resuming workflows.

The codebase already has a persistence kernel port: `IWorkflowPersistenceService` and `WORKFLOW_PERSISTENCE_SERVICE` in `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`. This epic deepens that existing port instead of creating a duplicate `IWorkflowPersistencePort` abstraction.

---

## 2. High-Level Context

### 2.1 Current Structure

```typescript
@Injectable()
export class WorkflowPersistenceService {
  constructor(
    private readonly repos: WorkflowRepositoryAggregator,
    public readonly parser: WorkflowParserService,         // public — leaked seam
    public readonly validator: WorkflowValidationService,  // public — leaked seam
    private readonly yamlValidator: YAMLValidationService,
  ) {}

  async createWorkflow(yamlDefinition: string): Promise<IWorkflow> {
    this.yamlValidator.validateAndThrow(yamlDefinition);  // YAML validation
    const def = this.parser.parseWorkflow(yamlDefinition);  // Parsing
    await this.validator.validateAndThrow(def);             // Validation
    return this.repos.workflows.create({...});              // Persistence
  }

  async getWorkflow(id: string): Promise<IWorkflow> { ... }    // Persistence only
  async getAllWorkflows(options?) { ... }                       // Persistence only
  async getAllWorkflowsPaged(pagination, options?) { ... }      // Persistence only
  async getWorkflowRuns(filters?) { ... }                       // Persistence only
  // ... ~10 more methods, all persistence
}
```

### 2.2 Problems

1. **Public fields leak internal seams:** `public readonly parser` and `public readonly validator` expose internal dependencies that callers should not depend on.
2. **Engine reaches through persistence:** `WorkflowEngineService` calls `this.persistence.parser.parseWorkflow(...)` and `this.persistence.validator.validateAndThrow(...)`, so persistence cannot hide parsing/validation.
3. **Existing port is not enforced:** `IWorkflowPersistenceService` exists, but `WorkflowPersistenceService` does not explicitly implement it and most callers still inject the concrete service.
4. **Definition loading is unnamed:** Runtime definition hydration currently means "load persisted YAML, parse, resolve prompt files, validate". That is orchestration preparation, not raw persistence.
5. **Poor test locality:** Engine tests must construct persistence with parser/validator because engine depends on the concrete class and leaked fields.

### 2.3 What Callers Actually Need

- `WorkflowController` and workflow meta tools need workflow catalog CRUD and run queries.
- `WorkflowEngineService` needs workflow lookup plus run creation/status updates, and it needs a hydrated workflow definition for execution.
- No caller should access `parser` or `validator` through `WorkflowPersistenceService`.

---

## 3. Goals

1. Reuse `IWorkflowPersistenceService` / `WORKFLOW_PERSISTENCE_SERVICE` as the canonical workflow persistence port.
2. Make `WorkflowPersistenceService` explicitly implement the existing persistence interface.
3. Remove public parser/validator fields by making them private.
4. Introduce a small workflow definition loading seam so runtime code no longer reaches through persistence internals.
5. Preserve external behavior, HTTP contracts, event names, and database schema.

---

## 4. Non-Goals

1. No changes to `WorkflowParserService` or `WorkflowValidationService` internals.
2. No changes to database schema or repository structure.
3. No changes to YAML validation logic.
4. No broad extraction of parser or validation internals; only add the minimal seam needed to hide them from persistence callers.

---

## 5. Implementation Phases

### Phase 1: Correct the Existing Kernel Port

- **Task E183-001: Update `IWorkflowPersistenceService` in place**
  - File: `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`.
  - Keep the existing `WORKFLOW_PERSISTENCE_SERVICE` token.
  - Keep method names aligned with current behavior: `getWorkflow` and `getWorkflowRun` throw `NotFoundException` rather than returning `null`.
  - Add only the run mutation methods needed by orchestration if the engine will inject the port directly: `createRun`, `updateRun`, and `updateRunStatus`.
  - Do not create a second `IWorkflowPersistencePort` token.

- **Task E183-002: Make `WorkflowPersistenceService` implement the existing interface**
  - File: `apps/api/src/workflow/workflow-persistence.service.ts`.
  - Add `implements IWorkflowPersistenceService`.
  - Keep the provider binding in `WorkflowModule`: `{ provide: WORKFLOW_PERSISTENCE_SERVICE, useExisting: WorkflowPersistenceService }`.

### Phase 2: Deepen the Service

### Phase 2: Hide Parser and Validator

- **Task E183-003: Add a workflow definition loading seam**
  - Create `apps/api/src/workflow/workflow-definition-loader.service.ts`.
  - Responsibility: load a persisted workflow's YAML into an executable `IWorkflowDefinition` by parsing, resolving external prompts, and validating the resolved definition.
  - Dependencies: `WorkflowParserService`, `PromptLoaderService`, and `WorkflowValidationService`.

- **Task E183-004: Make parser and validator private**
  - File: `apps/api/src/workflow/workflow-persistence.service.ts`.
  - Change `public readonly parser` and `public readonly validator` to `private readonly`.
  - Keep create/update validation behavior unchanged.

- **Task E183-005: Update engine runtime definition loading**
  - File: `apps/api/src/workflow/workflow-engine.service.ts`.
  - Replace `this.persistence.parser.parseWorkflow(...)` and `this.persistence.validator.validateAndThrow(...)` with calls to `WorkflowDefinitionLoaderService`.

### Phase 3: Register and Migrate Callers

- **Task E183-006: Register the new loader**
  - File: `apps/api/src/workflow/workflow.module.ts`.
  - Add `WorkflowDefinitionLoaderService` to providers and export it only if another module needs it.

- **Task E183-007: Move persistence callers to the existing token where useful**
  - Prefer `@Inject(WORKFLOW_PERSISTENCE_SERVICE) private readonly persistence: IWorkflowPersistenceService` for consumers that only need persistence behavior.
  - Do not change callers that legitimately need repositories or other lower-level domain services.

### Phase 4: Verify

- **Task E183-008: Run build and typecheck**
  - `npm run build:api`
  - Verify zero TypeScript errors.

- **Task E183-009: Run tests**
  - `npm run test:api`
  - Verify all tests pass.

-- **Task E183-010: Verify seam depth**

- Search for `persistence.parser` and `persistence.validator` — there should be zero matches outside `WorkflowPersistenceService` tests.
- Verify no new duplicate persistence port token exists.

---

## 6. Expected Outcomes

| Metric                                                     | Before                                            | After                                 |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `WorkflowPersistenceService` public fields                 | 2 (`parser`, `validator`)                         | 0                                     |
| Persistence kernel token                                   | Existing but underused                            | Canonical persistence injection token |
| Services depending on parser/validator through persistence | `WorkflowEngineService`                           | 0                                     |
| Test isolation                                             | Poor (must mock parser + validator + persistence) | Good (mock port only)                 |

---

## 7. Risk and Mitigation

| Risk                                                   | Mitigation                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Some callers legitimately need `parser` or `validator` | If true, those callers should depend on `WorkflowParserService` / `WorkflowValidationService` directly, not through `WorkflowPersistenceService` |
| Duplicate port abstraction                             | Reuse `WORKFLOW_PERSISTENCE_SERVICE`; do not add a new persistence token                                                                         |
| Existing tests that access `persistence.parser` break  | Update tests to import `WorkflowParserService` directly                                                                                          |
| Definition loader becomes a dumping ground             | Keep it limited to persisted YAML -> resolved `IWorkflowDefinition`                                                                              |
