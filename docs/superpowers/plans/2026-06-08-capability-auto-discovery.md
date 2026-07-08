# Capability Auto-Discovery for Internal Tool Handlers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the dual-registration requirement for internal tool handlers so that adding a new `IInternalToolHandler` implementation automatically exposes it as an agent-callable capability, with no separate `@Capability` stub needed.

**Architecture:** `CapabilityRegistryService` already scans all NestJS providers at startup via `DiscoveryService`. The change extends this scan to also detect providers that implement `IInternalToolHandler` (duck-typed via `getName()` + `getDefinition()`) and register their definitions directly. Deduplication by name is added to the scan so the transition can be staged: @Capability stubs and auto-discovery can coexist, then stubs are removed once the registry handles them. The seed-data validation helper is updated to mirror the new discovery path.

**Tech Stack:** NestJS, TypeScript, Vitest, `@nestjs/core` DiscoveryService, `@nexus/core` `IInternalToolHandler`

---

## Background

Every `IInternalToolHandler` already declares its full capability definition in `getDefinition()`. The `@Capability` stubs in capability providers (e.g. `WorkflowContextCapabilityProvider`) duplicate this data verbatim. The registry's current `discover()` only reads `@Capability` decorator metadata — `getDefinition()` is invisible to it. This caused a production bug (memory learning sweep tools missing from agent snapshots) and will recur for every new tool.

## File Map

| File | Change |
|------|--------|
| `apps/api/src/capability-infra/capability-registry.service.ts` | Add `collectInternalToolHandler()`, add dedup in `discover()` |
| `apps/api/src/capability-infra/capability-registry.service.spec.ts` | **Create** — unit tests for auto-discovery and dedup |
| `apps/api/src/database/seeds/seed-data-validation.tool-discovery.helpers.ts` | Add 11 missing tools to `HANDLER_CLASSES` |
| `apps/api/src/workflow/providers/workflow-context-capability.provider.ts` | Remove 21 redundant `@Capability` stubs; clean imports |
| `apps/api/src/workflow/providers/workflow-management-capability.provider.ts` | Remove redundant `@Capability` stubs for tools with handler implementations |

---

## Task 1: Unit tests for IInternalToolHandler auto-discovery

**Files:**
- Create: `apps/api/src/capability-infra/capability-registry.service.spec.ts`

These tests drive the registry changes in Task 2. Write them first — they will fail until Task 2 is complete.

- [ ] **Step 1.1: Create the spec file**

```typescript
// apps/api/src/capability-infra/capability-registry.service.spec.ts
import { Test } from '@nestjs/testing';
import { DiscoveryModule, MetadataScanner } from '@nestjs/core';
import { Injectable } from '@nestjs/common';
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { CapabilityRegistryService } from './capability-registry.service';
import { Capability } from './capability.decorator';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

@Injectable()
class AutoToolA implements IInternalToolHandler {
  getName() {
    return 'auto_tool_a';
  }
  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'auto_tool_a',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only'],
      description: 'Auto-discovered tool A',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/test/auto-a',
        bodyMapping: { foo: 'foo' },
      },
      inputSchema: z.object({ foo: z.string() }),
    };
  }
  execute(_ctx: InternalToolExecutionContext, _params: unknown) {
    return Promise.resolve({});
  }
}

@Injectable()
class AutoToolB implements IInternalToolHandler {
  getName() {
    return 'auto_tool_b';
  }
  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'auto_tool_b',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      description: 'Auto-discovered tool B',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/test/auto-b',
        bodyMapping: {},
      },
      inputSchema: z.object({}),
    };
  }
  execute(_ctx: InternalToolExecutionContext, _params: unknown) {
    return Promise.resolve({});
  }
}

// A provider that has both a @Capability stub AND an IInternalToolHandler —
// used to verify deduplication.
@Injectable()
class DualRegistrationTool implements IInternalToolHandler {
  getName() {
    return 'dual_tool';
  }
  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'dual_tool',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      description: 'Dual-registered tool',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/test/dual',
        bodyMapping: {},
      },
      inputSchema: z.object({}),
    };
  }
  execute(_ctx: InternalToolExecutionContext, _params: unknown) {
    return Promise.resolve({});
  }
}

class DualStubProvider {
  @Capability({
    name: 'dual_tool',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    description: 'Dual-registered tool',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/test/dual',
      bodyMapping: {},
    },
    inputSchema: z.object({}),
  })
  dualTool() {
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildRegistry(
  extraProviders: unknown[],
): Promise<CapabilityRegistryService> {
  const module = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [CapabilityRegistryService, MetadataScanner, ...extraProviders],
  }).compile();

  await module.init(); // triggers OnModuleInit → discover()
  return module.get(CapabilityRegistryService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CapabilityRegistryService', () => {
  describe('IInternalToolHandler auto-discovery', () => {
    it('discovers a capability from getDefinition() without a @Capability stub', async () => {
      const registry = await buildRegistry([AutoToolA]);

      const names = registry.getDiscoveredEntries().map((e) => e.name);
      expect(names).toContain('auto_tool_a');
    });

    it('populates all manifest fields from getDefinition()', async () => {
      const registry = await buildRegistry([AutoToolA]);

      const entry = registry.getDiscoveredEntryByName('auto_tool_a');
      expect(entry).toBeDefined();
      expect(entry?.transport).toBe('api_callback');
      expect(entry?.runtimeOwner).toBe('api');
      expect(entry?.description).toBe('Auto-discovered tool A');
      expect(entry?.apiCallback?.pathTemplate).toBe('/api/test/auto-a');
    });

    it('discovers multiple IInternalToolHandler providers', async () => {
      const registry = await buildRegistry([AutoToolA, AutoToolB]);

      const names = registry.getDiscoveredEntries().map((e) => e.name);
      expect(names).toContain('auto_tool_a');
      expect(names).toContain('auto_tool_b');
    });

    it('deduplicates when @Capability stub and IInternalToolHandler share a name', async () => {
      const registry = await buildRegistry([
        DualRegistrationTool,
        DualStubProvider,
      ]);

      const entries = registry.getDiscoveredEntries().filter(
        (e) => e.name === 'dual_tool',
      );
      expect(entries).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 1.2: Run the tests — confirm they fail**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/capability-infra/capability-registry.service.spec.ts
```

Expected output: 3–4 failures. The tests referencing `auto_tool_a` fail because the registry ignores `IInternalToolHandler`. The dedup test may or may not fail depending on current behaviour. Any failure confirms RED.

---

## Task 2: Implement auto-discovery + deduplication in CapabilityRegistryService

**Files:**
- Modify: `apps/api/src/capability-infra/capability-registry.service.ts`

- [ ] **Step 2.1: Add the `@nexus/core` import**

At the top of `capability-registry.service.ts`, add:

```typescript
import type { IInternalToolHandler } from '@nexus/core';
```

Alongside the existing imports.

- [ ] **Step 2.2: Replace `discover()` with a deduplicating version and add two new private methods**

Replace the existing `discover()` method (lines ~23–42) with:

```typescript
private discover() {
  const providers = this.discovery.getProviders();
  const allEntries: CapabilityManifestEntry[] = [];
  const bridgeActions = new Set<string>();

  for (const wrapper of providers) {
    const instance: unknown = wrapper.instance;
    if (!this.isScannableInstance(instance)) {
      continue;
    }

    this.collectMethodMetadata(instance, allEntries, bridgeActions);
    this.collectClassMetadata(instance, allEntries, bridgeActions);
    this.collectInternalToolHandler(instance, allEntries);
  }

  // Deduplicate by name — first registration wins. This lets @Capability stubs
  // and IInternalToolHandler coexist during migration; the stubs will be
  // removed in a follow-up cleanup.
  const seenNames = new Set<string>();
  const dedupedEntries: CapabilityManifestEntry[] = [];
  for (const entry of allEntries) {
    if (!seenNames.has(entry.name)) {
      seenNames.add(entry.name);
      dedupedEntries.push(entry);
    }
  }

  dedupedEntries.sort((a, b) => a.name.localeCompare(b.name));

  this.discoveredEntries = dedupedEntries;
  this.discoveredBridgeActions = bridgeActions;
}
```

Then add these two private methods anywhere after `collectClassMetadata`:

```typescript
private collectInternalToolHandler(
  instance: Record<string, unknown>,
  entries: CapabilityManifestEntry[],
): void {
  if (!this.isInternalToolHandler(instance)) return;
  const definition = instance.getDefinition();
  entries.push(this.buildEntry(definition as unknown as DiscoveredCapabilityDefinition));
}

private isInternalToolHandler(
  instance: Record<string, unknown>,
): instance is IInternalToolHandler {
  return (
    typeof instance.getName === 'function' &&
    typeof instance.getDefinition === 'function'
  );
}
```

- [ ] **Step 2.3: Run the unit tests — confirm they pass**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/capability-infra/capability-registry.service.spec.ts
```

Expected: `Tests 4 passed (4)`.

- [ ] **Step 2.4: Run the full seed-data validation spec — confirm no regression**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts
```

Expected: `Tests 5 passed (5)`.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/capability-infra/capability-registry.service.ts \
        apps/api/src/capability-infra/capability-registry.service.spec.ts
git commit -m "feat(capability): auto-discover IInternalToolHandler providers as capabilities

CapabilityRegistryService now detects any NestJS provider that implements
IInternalToolHandler (duck-typed via getName() + getDefinition()) and
registers its definition in the capability snapshot automatically.

Deduplication by name is added so @Capability stubs and handler definitions
can coexist during the migration period."
```

---

## Task 3: Complete HANDLER_CLASSES in the seed validation helper

`HANDLER_CLASSES` is used by `discoverKnownToolNames()` to populate the known-tool set for seed validation. Eleven handlers are registered in `INTERNAL_TOOL_HANDLER` but missing from this list, meaning the validation does not verify their names against workflow YAML references.

**Files:**
- Modify: `apps/api/src/database/seeds/seed-data-validation.tool-discovery.helpers.ts`

- [ ] **Step 3.1: Add missing imports at the top of the file**

After the existing tool imports (around line 26), add:

```typescript
import { RecordLearningTool } from '../../workflow/workflow-internal-tools/tools/memory/record-learning.tool';
import { ListPendingLearningCandidatesTool } from '../../workflow/workflow-internal-tools/tools/memory/list-pending-learning-candidates.tool';
import { PromoteLearningCandidateTool } from '../../workflow/workflow-internal-tools/tools/memory/promote-learning-candidate.tool';
import { RejectLearningCandidateTool } from '../../workflow/workflow-internal-tools/tools/memory/reject-learning-candidate.tool';
import { CreateSkillProposalTool } from '../../workflow/workflow-internal-tools/tools/memory/create-skill-proposal.tool';
import { SearchWorkflowsTool } from '../../workflow/workflow-internal-tools/tools/workflow/search-workflows.tool';
import { ReadWorkflowSummaryTool } from '../../workflow/workflow-internal-tools/tools/workflow/read-workflow-summary.tool';
import { SearchSkillsTool } from '../../workflow/workflow-internal-tools/tools/skill/search-skills.tool';
import { ReadSkillManifestTool } from '../../workflow/workflow-internal-tools/tools/skill/read-skill-manifest.tool';
import { SearchPlaybooksTool } from '../../workflow/workflow-internal-tools/tools/playbook/search-playbooks.tool';
import { ReadPlaybookTool } from '../../workflow/workflow-internal-tools/tools/playbook/read-playbook.tool';
```

> **Note:** The workflow-internal-tools module uses aliased class names for `SearchWorkflows` and `ReadWorkflowSummary` (imported as `SearchWorkflowsToolClass` and `ReadWorkflowSummaryToolClass` in the module file). Check the actual export names in the respective `.tool.ts` files; adjust the import names if the exported class name differs.

- [ ] **Step 3.2: Add the 11 missing tools to HANDLER_CLASSES**

In `HANDLER_CLASSES` (around line 53), append after `ManageTodoListTool`:

```typescript
  RecordLearningTool,
  ListPendingLearningCandidatesTool,
  PromoteLearningCandidateTool,
  RejectLearningCandidateTool,
  CreateSkillProposalTool,
  SearchWorkflowsTool,
  ReadWorkflowSummaryTool,
  SearchSkillsTool,
  ReadSkillManifestTool,
  SearchPlaybooksTool,
  ReadPlaybookTool,
```

- [ ] **Step 3.3: Run the seed validation spec — confirm still passing**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts
```

Expected: `Tests 5 passed (5)`.

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/database/seeds/seed-data-validation.tool-discovery.helpers.ts
git commit -m "fix(seed-validation): add 11 missing tool handlers to HANDLER_CLASSES

RecordLearning, the 4 learning sweep tools, search-workflows,
read-workflow-summary, search/read-skill-manifest, and
search/read-playbook were registered as IInternalToolHandler providers
but absent from HANDLER_CLASSES, leaving them unvalidated against
workflow YAML tool references."
```

---

## Task 4: Remove redundant @Capability stubs from WorkflowContextCapabilityProvider

These stubs duplicate what `getDefinition()` already provides. The registry now auto-discovers the handlers so the stubs are dead code.

**Files:**
- Modify: `apps/api/src/workflow/providers/workflow-context-capability.provider.ts`

Stubs to remove (all have corresponding `IInternalToolHandler` implementations):
`query_memory`, `manage_todo_list`, `list_pending_learning_candidates`, `promote_learning_candidate`, `reject_learning_candidate`, `create_skill_proposal`, `search_workflows`, `read_workflow_summary`, `search_skills`, `read_skill_manifest`, `search_playbooks`, `read_playbook`, `list_schedules`, `get_schedule`, `create_scheduled_job`, `update_scheduled_job`, `pause_scheduled_job`, `resume_scheduled_job`, `run_scheduled_job_now`, `delete_scheduled_job`, `list_schedule_runs`

Stubs to **keep** (no corresponding handler — handled by controller or bridge):
`get_capabilities`, `get_agent_profiles`, `get_agent_profile`, `list_agent_profile_names` (verify exact method names in the file before removing)

- [ ] **Step 4.1: Write a guard test before making changes**

Before touching the provider, capture the current discovered capability count and confirm the 4 kept stubs still appear after cleanup. Add to `seed-data.validation.spec.ts`:

```typescript
it('retains non-handler capabilities from WorkflowContextCapabilityProvider', () => {
  // These capabilities have no IInternalToolHandler — they MUST remain
  // discoverable via the @Capability stub after handler stubs are removed.
  expect(Array.from(discoverKnownToolNames())).toEqual(
    expect.arrayContaining([
      'get_capabilities',
      'get_agent_profiles',
      'get_agent_profile',
    ]),
  );
});
```

Run to confirm it currently passes:
```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts -t "retains non-handler capabilities"
```

- [ ] **Step 4.2: Delete the 21 handler-backed @Capability stub methods**

In `workflow-context-capability.provider.ts`, delete the `@Capability` decorated method + stub body for each of the 21 tools listed above. The pattern to delete for each:

```typescript
  @Capability({
    name: '<tool_name>',
    // ...all fields...
  })
  <methodName>() {
    return { ok: true };
  }
```

After removal, the file should contain only 4 methods: `getCapabilities`, `getAgentProfiles`, `getAgentProfile`, and `listAgentProfileNames` (or whatever names they use — verify in the file).

- [ ] **Step 4.3: Clean up now-unused imports**

Remove the schema imports that were only used by the deleted stubs. The imports from `@nexus/core` used only in deleted stubs:
- `queryMemoryBodySchema`
- `manageTodoListBodySchema`
- `scheduleListBodySchema`
- `readWorkflowSummarySchema`
- `searchWorkflowsSchema`
- `searchSkillsSchema`
- `skillManifestIdentitySchema`
- `searchPlaybooksSchema`
- `playbookIdentitySchema`
- `scheduleIdentitySchema`
- `createScheduleSchema`
- `updateScheduleSchema`
- `listScheduleRunsSchema`

Also remove the 4 local tool schema imports that were added for the learning tools:
```typescript
import { listPendingLearningCandidatesSchema } from '../workflow-internal-tools/tools/memory/list-pending-learning-candidates.tool';
import { promoteLearningCandidateSchema } from '../workflow-internal-tools/tools/memory/promote-learning-candidate.tool';
import { rejectLearningCandidateSchema } from '../workflow-internal-tools/tools/memory/reject-learning-candidate.tool';
import { createSkillProposalSchema } from '../workflow-internal-tools/tools/memory/create-skill-proposal.tool';
```

The only remaining import from `@nexus/core` in this file should be the schemas still needed by the 4 kept stubs. Run the TypeScript compiler to confirm no unused imports remain:

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "workflow-context-capability"
```

Expected: no output (no errors in that file).

- [ ] **Step 4.4: Run all affected tests**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts src/capability-infra/capability-registry.service.spec.ts
```

Expected: `Tests 6 passed (6)`.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/workflow/providers/workflow-context-capability.provider.ts \
        apps/api/src/database/seeds/seed-data.validation.spec.ts
git commit -m "refactor(capabilities): remove redundant @Capability stubs backed by IInternalToolHandler

21 stub methods in WorkflowContextCapabilityProvider are now auto-registered
by CapabilityRegistryService via getDefinition(). Removing them eliminates
duplicate registration and prevents future capability registration gaps of
the same kind."
```

---

## Task 5: Remove redundant @Capability stubs from WorkflowManagementCapabilityProvider

This file likely contains stubs for the 5 workflow CRUD tools that have handler implementations: `create_workflow_definition`, `update_workflow_definition`, `delete_workflow_definition`, `get_workflow`, `list_workflows`.

**Files:**
- Modify: `apps/api/src/workflow/providers/workflow-management-capability.provider.ts`

- [ ] **Step 5.1: Read the file and identify stubs with handler implementations**

```bash
grep -n "name:" apps/api/src/workflow/providers/workflow-management-capability.provider.ts
```

Cross-reference the names against the `INTERNAL_TOOL_HANDLER` inject array in `workflow-internal-tools.module.ts`. Any stub whose `name:` matches a handler's `getName()` is a candidate for removal.

- [ ] **Step 5.2: Write guard tests for capabilities that must survive**

Extend the guard test in `seed-data.validation.spec.ts` to include any non-handler capabilities in this file. Run the test to confirm it passes before making changes:

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts
```

- [ ] **Step 5.3: Delete the identified handler-backed stubs and clean unused imports**

Apply the same removal pattern as Task 4.2–4.3.

Verify no TypeScript errors:
```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "workflow-management-capability"
```

- [ ] **Step 5.4: Run all tests**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts src/capability-infra/capability-registry.service.spec.ts
```

Expected: all passing.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/workflow/providers/workflow-management-capability.provider.ts \
        apps/api/src/database/seeds/seed-data.validation.spec.ts
git commit -m "refactor(capabilities): remove IInternalToolHandler-backed stubs from WorkflowManagementCapabilityProvider"
```

---

## Task 6: Final verification and push

- [ ] **Step 6.1: Run the full validation spec**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/database/seeds/seed-data.validation.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6.2: Run the registry unit tests**

```bash
cd apps/api && npx vitest run --config vitest.config.ts src/capability-infra/capability-registry.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6.3: Typecheck with no new errors in changed files**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -vE "src/acp/__tests__|src/ai-config/__tests__|seed-data-validation-improvements"
```

Expected: no output (all errors shown are pre-existing in files not touched by this plan).

- [ ] **Step 6.4: Push**

```bash
git push
```

---

## What this does NOT change

- **API endpoints and controllers** — unchanged. The `POST /api/workflow-runtime/learning/...` routes that execute the tools remain as-is.
- **Internal tool execution path** — unchanged. The `INTERNAL_TOOL_HANDLER` multi-provider and `InternalToolRegistryService` are unchanged.
- **`CapabilityRegistrarService` DB seeding** — unchanged. The "Registry conflict" warnings in the logs come from a separate service seeding capabilities into the DB. That is a separate concern.
- **Other capability providers** (delegation, war-room, browser, approvals) — these do not have corresponding `IInternalToolHandler` implementations; their `@Capability` stubs are the correct and only registration for those tools.

---

## Self-review

**Spec coverage:**
- ✅ Auto-discovery from `IInternalToolHandler.getDefinition()` → Task 2
- ✅ No duplicate registrations → Task 2 (dedup in `discover()`)
- ✅ Validation helper mirrors runtime → Task 3
- ✅ Redundant stubs removed from `WorkflowContextCapabilityProvider` → Task 4
- ✅ Redundant stubs removed from `WorkflowManagementCapabilityProvider` → Task 5
- ✅ Tests verify behaviour before and after → Task 1, 4.1, 6

**Placeholder scan:** No TBD or "implement later" present. Task 5.1 uses a `grep` command as the discovery mechanism (concrete tooling, not vague instruction).

**Type consistency:** `IInternalToolHandler` used in Task 1 test file and Task 2 implementation matches the `@nexus/core` interface. `DiscoveredCapabilityDefinition` cast in Task 2 is clearly labelled. `CapabilityManifestEntry` is the return type of `buildEntry()` throughout.
