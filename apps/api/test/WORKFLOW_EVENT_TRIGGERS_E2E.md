# Workflow Event-Driven Triggers - E2E Tests

Comprehensive E2E tests for the workflow event trigger system. Tests verify that:

- Workflows declare event triggers in YAML
- The system auto-discovers and registers listeners at startup
- Events properly invoke workflows with correct trigger data
- Multiple workflows can listen to the same event
- Error handling is resilient

## Test Coverage

### 1. Event Trigger Registration at Startup (7 tests)

**`should initialize and log when no workflows exist`**

- Verifies service initializes even if no workflows exist
- Checks initialization logging

**`should skip inactive workflows`**

- Inactive workflows are not registered as triggers
- Service correctly filters `is_active: false`

**`should register event trigger for workflow with event trigger declaration`**

- Workflows with `trigger.type: event` are discovered
- Dynamic event listeners are registered
- Success is logged

**`should skip workflows without event triggers`**

- Workflows with `manual` or `webhook` triggers are skipped
- Only event-triggered workflows are registered

**`should handle missing trigger name gracefully`**

- Workflows missing `trigger.name` or `trigger.event` are skipped
- Warning is logged instead of failing

**`should recover from workflow parse errors and continue`**

- Parse errors don't crash initialization
- Remaining workflows are still processed
- Errors are logged

### 2. Event Emission and Workflow Invocation (5 tests)

**`should trigger workflow when registered event is emitted`**

- Event emission causes workflow to start
- Workflow engine is called with correct workflow ID

**`should pass trigger data to workflow`**

- Event payload is extracted and passed to workflow
- Trigger data contains all event properties

**`should handle event with object payload`**

- Object/class instance events are properly serialized
- All properties are passed to workflow

**`should handle event with primitive payload`**

- String/number primitives are wrapped in object
- Format: `{ value: payload }`

**`should handle event with no payload`**

- Events without payloads pass empty object
- Workflow receives valid trigger data

### 3. Multiple Workflows Listening to Same Event (2 tests)

**`should trigger multiple workflows on same event`**

- Multiple workflows can listen to same event
- All registered workflows are invoked
- Each receives correct trigger data

**`should execute workflows independently`**

- Workflows execute in parallel
- Failure in one doesn't prevent others from executing
- Error handling is isolated

### 4. Error Handling and Resilience (3 tests)

**`should handle workflow engine failure gracefully`**

- Workflow engine failures are caught and logged
- Event processing doesn't crash
- System remains stable

**`should handle initialization failure without crashing app`**

- Database/repo failures during initialization are handled
- App can start even if trigger registration fails
- Errors are logged for debugging

**`should support both trigger.name and trigger.event fields`**

- Flexible field naming for YAML definitions
- Backward compatible with webhook trigger syntax
- Both fields work identically

### 5. Integration Scenarios (2 tests)

**`should handle complete event-to-workflow lifecycle`**

- Full flow: app startup → listener registration → event emission → workflow trigger
- Verifies all pieces work together
- Validates initialization and invocation logging

**`should support event chaining`**

- Multiple workflows can chain based on events
- Demonstrates extensibility of event system

## Running the Tests

### Run specific test file

```bash
npm --prefix apps/api run test:e2e -- test/workflow-event-trigger.e2e-spec.ts
```

### Run all E2E tests

```bash
npm --prefix apps/api run test:e2e
```

### Run with coverage

```bash
npm --prefix apps/api run test:e2e -- --coverage test/workflow-event-trigger.e2e-spec.ts
```

### Run with watch mode

```bash
npm --prefix apps/api run test:e2e -- --watch test/workflow-event-trigger.e2e-spec.ts
```

## Test Output

Expected output shows:

- ✅ 18 tests pass
- Service initialization logs
- Event registration logs
- Workflow trigger logs
- No errors in service operation

```
Test Files  1 passed (1)
     Tests  18 passed (18)
```

## Key Test Patterns

### 1. Mocking Workflow Repository

```typescript
(workflowRepo.findAll as any).mockResolvedValue([
  {
    id: 'wf-1',
    name: 'Test Workflow',
    yaml_definition: '...',
    is_active: true,
  },
]);
```

### 2. Mocking Workflow Parser

```typescript
(parser.parseWorkflow as any).mockReturnValue({
  workflow_id: 'test_wf',
  name: 'Test Workflow',
  trigger: { type: 'event', name: 'TestEvent' },
  steps: [],
});
```

### 3. Emitting Events and Verifying Workflow Invocation

```typescript
eventEmitter.emit('TestEvent', { data: 'value' });
await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for async handler

expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('test_wf', {
  data: 'value',
});
```

### 4. Testing Error Handling

```typescript
(workflowEngine.startWorkflow as any).mockRejectedValue(
  new Error('Engine failure')
);
const errorSpy = vi.spyOn(Logger.prototype, 'error');
eventEmitter.emit('FailEvent', {});
await new Promise((resolve) => setTimeout(resolve, 100));
expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(...), expect.any(String));
```

## What the Tests Validate

| Aspect                | Tested |
| --------------------- | ------ |
| Startup registration  | ✅     |
| Event discovery       | ✅     |
| Listener registration | ✅     |
| Event emission        | ✅     |
| Workflow invocation   | ✅     |
| Trigger data passing  | ✅     |
| Multiple workflows    | ✅     |
| Error resilience      | ✅     |
| Field flexibility     | ✅     |
| Integration flow      | ✅     |

## Dependencies

- **NestJS Testing Module** - Dependency injection and module testing
- **EventEmitter2** - Event emission and listening
- **Vitest** - Test execution and mocking

## Extending the Tests

To add new test cases:

1. **New event trigger scenario**: Add to appropriate describe block
2. **New error condition**: Add to "Error Handling and Resilience"
3. **New integration flow**: Add to "Integration Scenarios"

Example:

```typescript
it('should handle [scenario]', async () => {
  // Setup
  const workflows = [...];
  (workflowRepo.findAll as any).mockResolvedValue(workflows);

  // Execute
  await service.onModuleInit();
  eventEmitter.emit('SomeEvent', data);
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Verify
  expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(...);
});
```

## Files Tested

- `apps/api/src/workflow/workflow-event-trigger.service.ts` - Main service
- `apps/api/src/workflow/workflow-engine.service.ts` - Workflow invocation
- `apps/api/src/workflow/workflow-parser.service.ts` - YAML parsing
- `apps/api/src/database/repositories/workflow.repository.ts` - Workflow loading

## Related Documentation

- [WORKFLOW_EVENT_TRIGGERS.md](../docs/WORKFLOW_EVENT_TRIGGERS.md) - System architecture and usage
- [WORKFLOW_EVENT_TRIGGERS_IMPLEMENTATION.md](../docs/WORKFLOW_EVENT_TRIGGERS_IMPLEMENTATION.md) - Implementation details
