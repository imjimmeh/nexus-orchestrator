import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ExecutionLifecycleModule } from '../../execution-lifecycle/execution-lifecycle.module';
import { WorkflowRetrospectiveModule } from '../workflow-retrospective/workflow-retrospective.module';
import { RetrospectiveTraceService } from '../workflow-retrospective/retrospective-trace.service';
import { WorkflowRunOperationsModule } from './workflow-run-operations.module';

function getImports(moduleType: object): unknown[] {
  return (
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as unknown[]) ??
    []
  );
}

function getProviders(moduleType: object): unknown[] {
  return (
    (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) as unknown[]) ??
    []
  );
}

function resolveModuleClass(entry: unknown): unknown {
  if (
    entry &&
    typeof (entry as { forwardRef?: unknown }).forwardRef === 'function'
  ) {
    return (entry as { forwardRef: () => unknown }).forwardRef();
  }
  return entry;
}

describe('WorkflowRunOperationsModule wiring', () => {
  it('provides the read-only retrospective trace without importing the retrospective pipeline', () => {
    expect(getImports(WorkflowRunOperationsModule)).not.toContain(
      WorkflowRetrospectiveModule,
    );
    expect(getProviders(WorkflowRunOperationsModule)).toContain(
      RetrospectiveTraceService,
    );
  });

  it('imports ExecutionLifecycleModule exclusively via forwardRef (not as a plain class)', () => {
    const rawImports = getImports(WorkflowRunOperationsModule);
    const resolvedImports = rawImports.map(resolveModuleClass);

    expect(
      resolvedImports,
      'WorkflowRunOperationsModule must resolve ExecutionLifecycleModule through a forwardRef wrapper (not import the class directly)',
    ).toContain(ExecutionLifecycleModule);
    expect(
      rawImports,
      'ExecutionLifecycleModule must appear only as a forwardRef entry in the raw IMPORTS metadata, never as a bare class',
    ).not.toContain(ExecutionLifecycleModule);
  });
});
