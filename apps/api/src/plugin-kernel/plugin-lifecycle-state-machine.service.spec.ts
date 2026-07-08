import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PluginLifecycleStateMachineService } from './plugin-lifecycle-state-machine.service';
import type {
  PluginLifecycleState,
  PluginLifecycleTransitionResult,
} from './plugin-kernel.types';

describe('PluginLifecycleStateMachineService', () => {
  let module: TestingModule;
  let service: PluginLifecycleStateMachineService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [PluginLifecycleStateMachineService],
    }).compile();

    service = module.get(PluginLifecycleStateMachineService);
  });

  afterEach(async () => {
    await module.close();
  });

  it.each<[PluginLifecycleState, PluginLifecycleState]>([
    ['discovered', 'installed'],
    ['installed', 'scanned'],
    ['scanned', 'enabled'],
    ['enabled', 'disabled'],
    ['disabled', 'enabled'],
    ['quarantined', 'uninstalled'],
  ])('allows %s to transition to %s', (from, to) => {
    expect(service.canTransition(from, to)).toBe(true);
    expect(service.validateTransition(from, to)).toEqual({
      allowed: true,
      from,
      to,
    });
  });

  it.each<[PluginLifecycleState, PluginLifecycleState]>([
    ['discovered', 'enabled'],
    ['enabled', 'installed'],
    ['quarantined', 'enabled'],
    ['uninstalled', 'discovered'],
    ['installed', 'installed'],
  ])('denies %s to %s with a clear structured failure', (from, to) => {
    const result = service.validateTransition(from, to);

    expect(service.canTransition(from, to)).toBe(false);
    expect(result).toMatchObject({
      allowed: false,
      from,
      to,
      reason: 'transition_not_allowed',
    } satisfies Partial<PluginLifecycleTransitionResult>);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain(from);
      expect(result.message).toContain(to);
    }
  });

  it('returns allowed transitions for each non-terminal state', () => {
    expect(service.getAllowedTransitions('discovered')).toEqual([
      'installed',
      'quarantined',
      'uninstalled',
    ]);
    expect(service.getAllowedTransitions('installed')).toEqual([
      'scanned',
      'quarantined',
      'uninstalled',
    ]);
    expect(service.getAllowedTransitions('scanned')).toEqual([
      'enabled',
      'quarantined',
      'uninstalled',
    ]);
    expect(service.getAllowedTransitions('enabled')).toEqual([
      'disabled',
      'quarantined',
      'uninstalled',
    ]);
    expect(service.getAllowedTransitions('disabled')).toEqual([
      'enabled',
      'quarantined',
      'uninstalled',
    ]);
    expect(service.getAllowedTransitions('quarantined')).toEqual([
      'uninstalled',
    ]);
  });

  it('treats uninstalled as terminal', () => {
    expect(service.getAllowedTransitions('uninstalled')).toEqual([]);
    expect(service.canTransition('uninstalled', 'discovered')).toBe(false);
  });

  it('does not throw for valid API-facing transition assertions', () => {
    expect(() => {
      service.assertTransitionAllowed('discovered', 'installed');
    }).not.toThrow();
  });

  it('throws BadRequestException for invalid API-facing transition assertions', () => {
    expect(() => {
      service.assertTransitionAllowed('enabled', 'installed');
    }).toThrow(BadRequestException);
    expect(() => {
      service.assertTransitionAllowed('enabled', 'installed');
    }).toThrow('enabled');
    expect(() => {
      service.assertTransitionAllowed('enabled', 'installed');
    }).toThrow('installed');
  });

  it('fails closed for runtime-invalid source states', () => {
    const invalidState = 'archived' as PluginLifecycleState;

    expect(service.canTransition(invalidState, 'enabled')).toBe(false);
    expect(service.getAllowedTransitions(invalidState)).toEqual([]);

    const result = service.validateTransition(invalidState, 'enabled');

    expect(result).toMatchObject({
      allowed: false,
      from: invalidState,
      to: 'enabled',
      reason: 'invalid_lifecycle_state',
    } satisfies Partial<PluginLifecycleTransitionResult>);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain('archived');
      expect(result.message).toContain('from');
    }
  });

  it('fails closed for runtime-invalid target states', () => {
    const invalidState = 'retired' as PluginLifecycleState;

    expect(service.canTransition('enabled', invalidState)).toBe(false);

    const result = service.validateTransition('enabled', invalidState);

    expect(result).toMatchObject({
      allowed: false,
      from: 'enabled',
      to: invalidState,
      reason: 'invalid_lifecycle_state',
    } satisfies Partial<PluginLifecycleTransitionResult>);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain('retired');
      expect(result.message).toContain('to');
    }
  });

  it('throws BadRequestException for runtime-invalid API-facing transition assertions', () => {
    const invalidState = 'archived' as PluginLifecycleState;

    expect(() => {
      service.assertTransitionAllowed(invalidState, 'enabled');
    }).toThrow(BadRequestException);
    expect(() => {
      service.assertTransitionAllowed(invalidState, 'enabled');
    }).toThrow('archived');
  });
});
