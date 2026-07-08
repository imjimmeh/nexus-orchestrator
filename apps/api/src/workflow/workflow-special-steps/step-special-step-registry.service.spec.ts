import { EventEmitter2 } from '@nestjs/event-emitter';
import { RESERVED_SPECIAL_STEP_TYPES } from '@nexus/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateSpecialStepHandlerRegistrationError,
  InvalidSpecialStepHandlerRegistrationError,
  MissingSpecialStepHandlerRegistrationError,
} from './step-special-step-registry.errors';
import { StepEmitEventSpecialStepHandler } from './step-emit-event-special-step.handler';
import { StepSpecialStepRegistryService } from './step-special-step-registry.service';
import {
  CORE_SPECIAL_STEP_TYPES,
  ISpecialStepHandler,
} from './step-special-step.types';

function createHandler(type: string): ISpecialStepHandler {
  return {
    type,
    descriptor: {
      type,
      owningDomain: 'core',
      inputContract: `${type}.inputs`,
    },
    execute: () =>
      Promise.resolve({
        result: {
          status: 'completed',
          mode: 'emit_event',
          eventName: 'noop',
        },
        output: {
          ok: true,
        },
      }),
  };
}

function createPluginHandler(type: string): ISpecialStepHandler {
  return {
    type,
    descriptor: {
      type,
      owningDomain: 'plugin',
      pluginId: 'acme',
      inputContract: `${type}.inputs`,
    },
    execute: () =>
      Promise.resolve({
        result: {
          status: 'completed',
          source: 'plugin',
          mode: type,
        },
        output: {
          ok: true,
        },
      }),
  };
}

function createProjectedPluginHandler({
  type,
  pluginId,
  version,
  contributionId,
}: {
  type: string;
  pluginId: string;
  version: string;
  contributionId: string;
}): ISpecialStepHandler {
  return {
    ...createPluginHandler(type),
    descriptor: {
      type,
      owningDomain: 'plugin',
      pluginId,
      pluginVersion: version,
      contributionId,
      inputContract: `${type}.inputs`,
    },
  };
}

function createCoreHandlersWithConcreteEmitEvent(
  eventEmitter: EventEmitter2,
): ISpecialStepHandler[] {
  return CORE_SPECIAL_STEP_TYPES.map((type) =>
    type === 'emit_event'
      ? new StepEmitEventSpecialStepHandler(eventEmitter)
      : createHandler(type),
  );
}

describe('StepSpecialStepRegistryService', () => {
  it('registers handlers by type', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    expect(service.getHandler('run_command')?.type).toBe('run_command');
    expect(service.getDescriptors().length).toBe(
      CORE_SPECIAL_STEP_TYPES.length,
    );
  });

  it('keeps concrete core handlers registered and executable after plugin registration is rejected', async () => {
    const eventEmitter = { emit: vi.fn() } as unknown as EventEmitter2;
    const handlers = createCoreHandlersWithConcreteEmitEvent(eventEmitter);
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    expect(() => {
      service.registerPluginHandler(createPluginHandler('emit_event'));
    }).toThrow(InvalidSpecialStepHandlerRegistrationError);

    const concreteHandler = service.getHandler('emit_event');
    const result = await concreteHandler?.execute({
      workflowRunId: 'run-1',
      stepId: 'step-1',
      step: { id: 'step-1', type: 'emit_event' } as never,
      resolvedStepInputs: {
        event_name: 'PluginProjectionRegressionEvent',
        payload: { pluginId: 'acme' },
      },
    });

    expect(concreteHandler).toBeInstanceOf(StepEmitEventSpecialStepHandler);
    expect(result).toEqual({
      result: {
        status: 'completed',
        mode: 'emit_event',
        eventName: 'PluginProjectionRegressionEvent',
      },
      output: {
        ok: true,
        stepId: 'step-1',
        event_name: 'PluginProjectionRegressionEvent',
        emitted_at: expect.any(String),
      },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'PluginProjectionRegressionEvent',
      { pluginId: 'acme' },
    );
  });

  it('returns null for an unregistered plugin special step after core handlers initialize', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    expect(service.getHandler('plugin.example_step')).toBeNull();
  });

  it('registers a plugin handler after core registry initialization', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    const pluginHandler = createPluginHandler('acme.send_webhook');
    service.registerPluginHandler(pluginHandler);

    expect(service.getHandler('acme.send_webhook')).toBe(pluginHandler);
  });

  it('unregisters only the matching projected plugin handler', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();
    const pluginHandler = createProjectedPluginHandler({
      type: 'acme.send_webhook',
      pluginId: 'acme',
      version: '1.0.0',
      contributionId: 'send_webhook',
    });
    service.registerPluginHandler(pluginHandler);

    const removed = service.unregisterPluginHandler('acme.send_webhook', {
      pluginId: 'acme',
      version: '1.0.0',
      contributionId: 'send_webhook',
    });

    expect(removed).toBe(true);
    expect(service.getHandler('acme.send_webhook')).toBeNull();
  });

  it('does not unregister core handlers through plugin cleanup', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    const removed = service.unregisterPluginHandler('run_command', {
      pluginId: 'acme',
      version: '1.0.0',
      contributionId: 'run_command',
    });

    expect(removed).toBe(false);
    expect(service.getHandler('run_command')?.descriptor.owningDomain).toBe(
      'core',
    );
  });

  it('does not unregister a plugin handler for a different plugin version', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();
    const activeHandler = createProjectedPluginHandler({
      type: 'plugin:acme:shared_step',
      pluginId: 'acme',
      version: '2.0.0',
      contributionId: 'shared_step',
    });
    service.registerPluginHandler(activeHandler);

    const removed = service.unregisterPluginHandler('plugin:acme:shared_step', {
      pluginId: 'acme',
      version: '1.0.0',
      contributionId: 'shared_step',
    });

    expect(removed).toBe(false);
    expect(service.getHandler('plugin:acme:shared_step')).toBe(activeHandler);
  });

  it('keeps a plugin handler registered before core registry initialization', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    const pluginHandler = createPluginHandler('acme.send_webhook');

    service.registerPluginHandler(pluginHandler);
    service.onModuleInit();

    expect(service.getHandler('acme.send_webhook')).toBe(pluginHandler);
  });

  it('rejects plugin handlers that use current core handler types', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    expect(() => {
      service.registerPluginHandler(createPluginHandler('run_command'));
    }).toThrow(InvalidSpecialStepHandlerRegistrationError);
  });

  it('rejects plugin handlers with non-plugin owning domain', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();
    const pluginHandler = createPluginHandler('acme.send_webhook');
    pluginHandler.descriptor.owningDomain = 'core';

    expect(() => {
      service.registerPluginHandler(pluginHandler);
    }).toThrow(InvalidSpecialStepHandlerRegistrationError);
  });

  it('rejects plugin handlers missing pluginId', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();
    const pluginHandler = createPluginHandler('acme.send_webhook');
    delete pluginHandler.descriptor.pluginId;

    expect(() => {
      service.registerPluginHandler(pluginHandler);
    }).toThrow(InvalidSpecialStepHandlerRegistrationError);
  });

  it('fails fast when a required handler is missing', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.slice(1).map((type) =>
      createHandler(type),
    );
    const service = new StepSpecialStepRegistryService(handlers);

    expect(() => {
      service.onModuleInit();
    }).toThrow(MissingSpecialStepHandlerRegistrationError);
  });

  it('fails fast on duplicate handler registrations', () => {
    const handlers = [
      ...CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type)),
      createHandler('run_command'),
    ];
    const service = new StepSpecialStepRegistryService(handlers);

    expect(() => {
      service.onModuleInit();
    }).toThrow(DuplicateSpecialStepHandlerRegistrationError);
  });

  it('fails fast when descriptor metadata is invalid', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    handlers[0] = {
      ...handlers[0],
      descriptor: {
        ...handlers[0].descriptor,
        type: 'run_command',
      },
    };
    const service = new StepSpecialStepRegistryService(handlers);

    expect(() => {
      service.onModuleInit();
    }).toThrow(InvalidSpecialStepHandlerRegistrationError);
  });

  it('rejects handlers that use the reserved execution job type', () => {
    const handlers = [
      ...CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type)),
      createHandler('execution'),
    ];
    const service = new StepSpecialStepRegistryService(handlers);

    expect(() => {
      service.onModuleInit();
    }).toThrow(InvalidSpecialStepHandlerRegistrationError);
  });

  it('rejects plugin handlers that use deprecated legacy special-step types', () => {
    const handlers = CORE_SPECIAL_STEP_TYPES.map((type) => createHandler(type));
    const service = new StepSpecialStepRegistryService(handlers);
    service.onModuleInit();

    for (const reservedType of RESERVED_SPECIAL_STEP_TYPES) {
      expect(() => {
        service.registerPluginHandler(createPluginHandler(reservedType));
      }).toThrow(InvalidSpecialStepHandlerRegistrationError);
    }
  });
});
