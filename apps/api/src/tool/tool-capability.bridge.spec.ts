import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IInternalToolHandler } from '@nexus/core';
import { ToolCapabilityBridge } from './tool-capability.bridge';

interface MarkerCapability {
  marker(): string;
}

const makeTool = (name: string): IInternalToolHandler => ({
  getName: () => name,
  getDefinition: vi.fn(),
  execute: vi.fn(),
});

const makeCapableTool = (
  name: string,
): IInternalToolHandler & MarkerCapability => ({
  getName: () => name,
  getDefinition: vi.fn(),
  execute: vi.fn(),
  marker: () => name,
});

class TestBridge extends ToolCapabilityBridge<MarkerCapability> {
  readonly wired: Array<IInternalToolHandler & MarkerCapability> = [];

  protected supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & MarkerCapability {
    return typeof (tool as Partial<MarkerCapability>).marker === 'function';
  }

  protected wire(tool: IInternalToolHandler & MarkerCapability): void {
    this.wired.push(tool);
  }
}

describe('ToolCapabilityBridge', () => {
  let bridge: TestBridge;

  beforeEach(() => {
    bridge = new TestBridge([]);
  });

  it('wires only tools that support the capability', () => {
    const capable = makeCapableTool('capable');
    bridge = new TestBridge([makeTool('plain'), capable, makeTool('other')]);
    bridge.onModuleInit();
    expect(bridge.wired).toEqual([capable]);
  });

  it('handles an empty tool array without error', () => {
    bridge = new TestBridge([]);
    expect(() => {
      bridge.onModuleInit();
    }).not.toThrow();
    expect(bridge.wired).toEqual([]);
  });

  it('wires nothing when no tool supports the capability', () => {
    bridge = new TestBridge([makeTool('a'), makeTool('b')]);
    bridge.onModuleInit();
    expect(bridge.wired).toEqual([]);
  });

  it('wires every supporting tool when multiple match', () => {
    const a = makeCapableTool('a');
    const b = makeCapableTool('b');
    bridge = new TestBridge([a, makeTool('plain'), b]);
    bridge.onModuleInit();
    expect(bridge.wired).toEqual([a, b]);
  });
});
