import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IInternalToolHandler } from '@nexus/core';
import { ToolPromptContributorBridge } from './tool-prompt-contributor.bridge';
import type { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';

const makePlainTool = (name: string): IInternalToolHandler => ({
  getName: () => name,
  getDefinition: vi.fn(),
  execute: vi.fn(),
});

const makeContributingTool = (name: string): IInternalToolHandler => ({
  getName: () => name,
  getDefinition: vi.fn(),
  execute: vi.fn(),
  name: 'todo',
  contribute: vi.fn(),
});

describe('ToolPromptContributorBridge', () => {
  let assembly: Pick<SystemPromptAssemblyService, 'register'>;

  beforeEach(() => {
    assembly = { register: vi.fn() };
  });

  it('registers tools exposing a contribute function with the assembly service', () => {
    const contributing = makeContributingTool('get_todo_list');
    const bridge = new ToolPromptContributorBridge(
      [makePlainTool('plain'), contributing],
      assembly as SystemPromptAssemblyService,
    );
    bridge.onModuleInit();
    expect(assembly.register).toHaveBeenCalledTimes(1);
    expect(assembly.register).toHaveBeenCalledWith(contributing);
  });

  it('registers nothing when no tool exposes contribute', () => {
    const bridge = new ToolPromptContributorBridge(
      [makePlainTool('a'), makePlainTool('b')],
      assembly as SystemPromptAssemblyService,
    );
    bridge.onModuleInit();
    expect(assembly.register).not.toHaveBeenCalled();
  });

  it('handles an empty tool array without error', () => {
    const bridge = new ToolPromptContributorBridge(
      [],
      assembly as SystemPromptAssemblyService,
    );
    expect(() => {
      bridge.onModuleInit();
    }).not.toThrow();
    expect(assembly.register).not.toHaveBeenCalled();
  });
});
