import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { InternalToolRegistryService } from '../../tool/internal-tool-registry.service';
import { INTERNAL_TOOL_HANDLER } from '../../tool/internal-tool.tokens';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowRuntimeModule } from '../workflow-runtime/workflow-runtime.module';
import { WorkflowInternalToolsModule } from './workflow-internal-tools.module';

function getProviders(moduleType: object): unknown[] {
  return (
    (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) as unknown[]) ??
    []
  );
}

function getExports(moduleType: object): unknown[] {
  return (
    (Reflect.getMetadata(MODULE_METADATA.EXPORTS, moduleType) as unknown[]) ??
    []
  );
}

function getImports(moduleType: object): unknown[] {
  return (
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as unknown[]) ??
    []
  );
}

function providesInternalToolHandlerToken(moduleType: object): boolean {
  return getProviders(moduleType).some(
    (provider) =>
      typeof provider === 'object' &&
      provider !== null &&
      (provider as { provide?: unknown }).provide === INTERNAL_TOOL_HANDLER,
  );
}

describe('WorkflowInternalToolsModule wiring', () => {
  it('owns the internal tool registry alongside the handler token that populates it', () => {
    // The registry injects INTERNAL_TOOL_HANDLER with an @Optional() default of
    // []. It must be instantiated in the same module scope that provides the
    // token, otherwise it resolves to an empty handler set and every internal
    // tool call fails with "Internal tool handler <name> not found".
    expect(getProviders(WorkflowInternalToolsModule)).toContain(
      InternalToolRegistryService,
    );
    expect(providesInternalToolHandlerToken(WorkflowInternalToolsModule)).toBe(
      true,
    );
    expect(getExports(WorkflowInternalToolsModule)).toContain(
      InternalToolRegistryService,
    );
  });

  it('does not leave an unpopulated registry in WorkflowCoreModule', () => {
    expect(getProviders(WorkflowCoreModule)).not.toContain(
      InternalToolRegistryService,
    );
    expect(providesInternalToolHandlerToken(WorkflowCoreModule)).toBe(false);
  });

  it('wires WorkflowRuntimeModule to the populated registry', () => {
    expect(getImports(WorkflowRuntimeModule)).toContain(
      WorkflowInternalToolsModule,
    );
  });
});
