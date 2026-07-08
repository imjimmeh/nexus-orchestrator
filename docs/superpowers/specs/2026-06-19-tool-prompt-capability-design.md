# Tool Capability Bridge — Design Spec

**Date:** 2026-06-19
**Status:** Approved

## Problem

`TodoPromptContributor` is a cross-module bridge artifact: a class in `WorkflowRunOperationsModule` that knows about the todo tool group and manually wires it to `SystemPromptAssemblyService`. Every tool group wanting to inject system-prompt context must repeat the pattern — a separate contributor class, a separate module entry, and direct knowledge of the assembly seam.

This duplicates infrastructure that already exists: the `INTERNAL_TOOL_HANDLER` multi-provider token already collects every tool into one array, and `InternalToolRegistryService` already iterates it. A tool's prompt contribution should ride on the tool, discovered through the collection we already have — not through a parallel registration system.

## Goal

Tools that want to contribute to the system prompt declare it by implementing `ISystemPromptContributor` directly. A generic, reusable bridge discovers them from the existing tool array and wires them into the assembly seam. Adding prompt context for a tool requires no new collection mechanism and no per-tool module wiring beyond the tool already being a registered tool.

A second goal is reusability of the bridging _pattern_ itself: scanning the tool registry for a capability and wiring matches into a target seam will recur (lifecycle hooks, event subscriptions). That pattern is captured once in a generic base.

---

## Design

### Core Mechanism: generic Template-Method bridge over the existing tool array

The `INTERNAL_TOOL_HANDLER` token already aggregates every tool. A generic abstract bridge scans that array on `onModuleInit`, narrows each tool by a capability type guard, and wires matches into a target seam. Concrete subclasses supply only the two variable parts: which capability to detect, and how to wire it. No new collection token is introduced.

### New: `ToolCapabilityBridge<TCapability>` (abstract base)

```
apps/api/src/tool/tool-capability.bridge.ts
apps/api/src/tool/tool-capability.bridge.spec.ts
```

- `@Injectable()`, `abstract`, implements `OnModuleInit`
- Generic over `TCapability` — the capability interface a tool may also implement
- Constructor takes `protected readonly tools: IInternalToolHandler[]` (the existing aggregated array, injected by subclasses)
- Abstract `supports(tool: IInternalToolHandler): tool is IInternalToolHandler & TCapability` — capability type guard
- Abstract `wire(tool: IInternalToolHandler & TCapability): void` — seam wiring action
- `onModuleInit(): void` — iterates `tools`, calls `wire` for each tool where `supports` is true
- Strictly typed; no `any`. Lives in `apps/api/src/tool/` as generic tool infrastructure (alongside `InternalToolRegistryService`), not in the prompt layer.

```typescript
@Injectable()
export abstract class ToolCapabilityBridge<
  TCapability,
> implements OnModuleInit {
  constructor(protected readonly tools: IInternalToolHandler[]) {}

  protected abstract supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & TCapability;

  protected abstract wire(tool: IInternalToolHandler & TCapability): void;

  onModuleInit(): void {
    for (const tool of this.tools) {
      if (this.supports(tool)) {
        this.wire(tool);
      }
    }
  }
}
```

### New: `ToolPromptContributorBridge` (concrete subclass)

```
apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.ts
apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.spec.ts
```

- `@Injectable()`, extends `ToolCapabilityBridge<ISystemPromptContributor>`
- Injects `@Inject(INTERNAL_TOOL_HANDLER) tools: IInternalToolHandler[]` and `SystemPromptAssemblyService`; calls `super(tools)`
- `supports(tool)`: returns true when `typeof (tool as Partial<ISystemPromptContributor>).contribute === 'function'`
- `wire(tool)`: calls `this.assembly.register(tool)`
- Lives in `workflow-internal-tools/` with the tools it serves

### Modified: `GetTodoListTool` implements `ISystemPromptContributor`

```
apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.ts
apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.spec.ts
```

`GetTodoListTool` is the read tool — surfacing the current todo list to the system prompt is the same responsibility it already has (fetch and present todo state). It additionally implements `ISystemPromptContributor`:

- `name = 'todo'`, `priority = 50` (named constant)
- Gains a `WorkflowRunTodoService` constructor dependency alongside its existing `TodoToolsHandler`. The contribute path needs the service's run-id primitive `getTodoList(workflowRunId)` — exactly the call the deleted `TodoPromptContributor` made — rather than the handler's `getTodoList(params, context)` execution wrapper. `WorkflowRunTodoService` is already resolvable in this module's injector (the sibling `TodoToolsHandler` injects it today), so no new module import is required — verify at implementation time.
- `contribute(ctx)`: returns `null` for non-workflow or missing `workflowRunId`; otherwise calls `this.todoService.getTodoList(ctx.workflowRunId)` and returns a block with `title: 'Todo List'`, `priority: 50`, content = usage instructions + formatted table
- The static `manage_todo_list` usage instructions and the table formatting are migrated verbatim from the deleted `TodoPromptContributor` — no behaviour change to assembled output
- Its existing `getName()`/`getDefinition()`/`execute()` are unchanged (still delegating to `TodoToolsHandler`)

### Modified: `WorkflowInternalToolsModule`

Add to `providers`: `ToolPromptContributorBridge`. The bridge injects the already-provided `INTERNAL_TOOL_HANDLER` array and the global `SystemPromptAssemblyService`; it is internal and not exported. `GetTodoListTool` is already a provider and already in the `INTERNAL_TOOL_HANDLER` inject list — no change there.

### Deleted

- `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.ts`
- `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.spec.ts`

### Modified: `WorkflowRunOperationsModule`

Remove `TodoPromptContributor` from `providers`. No other changes.

---

## Module Boundary

`SystemPromptAssemblyModule` is `@Global()`. `ToolPromptContributorBridge` injects `SystemPromptAssemblyService` with no import declaration — consistent with the existing pattern.

The abstract `ToolCapabilityBridge` lives in `apps/api/src/tool/` and depends only on `IInternalToolHandler` (from `@nexus/core`) and `@nestjs/common` — it is prompt-agnostic and seam-agnostic.

`GetTodoListTool` adds a `WorkflowRunTodoService` dependency, already resolvable in this module's injector (its sibling `TodoToolsHandler` injects the same service today). No new module imports required.

`apps/api/src` remains Kanban-neutral throughout — no kanban, work-item, or project-domain identifiers.

---

## How to Add a Future Tool→Seam Bridge

1. Define (or reuse) a capability interface `ICapability`
2. A tool that has the capability implements `ICapability` alongside `IInternalToolHandler`
3. Create `<x>.bridge.ts`: `class XBridge extends ToolCapabilityBridge<ICapability>` supplying `supports` (type guard) and `wire` (seam action), injecting `INTERNAL_TOOL_HANDLER` plus whatever seam it targets
4. Add the concrete bridge to its module's `providers`

No new collection token, no per-tool wiring.

---

## Testing

**`ToolCapabilityBridge` spec** (via a minimal concrete test subclass):

- Calls `wire` exactly for tools where `supports` returns true; skips the rest
- Handles an empty tool array without error
- Does not call `wire` when no tool supports the capability

**`ToolPromptContributorBridge` spec:**

- `supports` is true for a tool exposing a `contribute` function, false for a plain tool
- `onModuleInit` registers every supporting tool with the assembly service and registers none that lack `contribute`

**`GetTodoListTool` spec (prompt-contribution cases):** mirrors the 8 cases from the deleted `todo-prompt.contributor.spec.ts` exactly — name/priority constants, `contribute` returns null for chat context and for missing `workflowRunId`, fetches with the `workflowRunId` from context, block title/priority shape, empty-list instructions + "No todos yet", and the ✅/🔄/⬜ icons with titles for the three statuses. Existing `getName`/`getDefinition`/`execute` tests remain.

**No regression:** the assembled system prompt content is byte-identical to today — same block title, same priority, same instructions, same formatting.

---

## What Does Not Change

- `ISystemPromptContributor` interface — untouched
- `IInternalToolHandler` interface in `@nexus/core` — untouched (capability is detected structurally, no core change)
- `SystemPromptAssemblyService` / `SystemPromptAssemblyModule` — untouched
- `InternalToolRegistryService` — untouched (stays a pure name→handler map; bridging is a separate concern)
- All other existing contributors and tools
- The assembled prompt seen by agents — identical output
