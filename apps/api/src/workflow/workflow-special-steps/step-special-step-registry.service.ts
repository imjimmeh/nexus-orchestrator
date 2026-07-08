import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  DuplicateSpecialStepHandlerRegistrationError,
  InvalidSpecialStepHandlerRegistrationError,
  MissingSpecialStepHandlerRegistrationError,
} from './step-special-step-registry.errors';
import {
  CORE_SPECIAL_STEP_TYPES,
  ISpecialStepHandler,
  isReservedSpecialStepType,
} from './step-special-step.types';

export const SPECIAL_STEP_HANDLERS = Symbol('SPECIAL_STEP_HANDLERS');

@Injectable()
export class StepSpecialStepRegistryService implements OnModuleInit {
  private readonly handlersByType = new Map<string, ISpecialStepHandler>();
  private readonly pluginHandlers: ISpecialStepHandler[] = [];

  constructor(
    @Inject(SPECIAL_STEP_HANDLERS)
    private readonly handlers: ISpecialStepHandler[],
  ) {}

  onModuleInit(): void {
    this.rebuildRegistry();
  }

  getHandler(stepType: string): ISpecialStepHandler | null {
    return this.handlersByType.get(stepType) ?? null;
  }

  registerPluginHandler(handler: ISpecialStepHandler): void {
    this.validatePluginHandler(handler);
    this.validatePluginHandlerTypeIsNotCoreDuplicate(handler);
    this.registerHandler(handler, { allowReservedCoreType: false });
    this.pluginHandlers.push(handler);
  }

  unregisterPluginHandler(
    stepType: string,
    target: {
      pluginId: string;
      version: string;
      contributionId: string;
    },
  ): boolean {
    const handler = this.handlersByType.get(stepType);
    if (
      !handler ||
      handler.descriptor.owningDomain !== 'plugin' ||
      handler.descriptor.pluginId !== target.pluginId ||
      handler.descriptor.pluginVersion !== target.version ||
      handler.descriptor.contributionId !== target.contributionId
    ) {
      return false;
    }

    this.handlersByType.delete(stepType);
    const index = this.pluginHandlers.findIndex(
      (pluginHandler) => pluginHandler === handler,
    );
    if (index >= 0) {
      this.pluginHandlers.splice(index, 1);
    }

    return true;
  }

  getDescriptors() {
    return [...this.handlersByType.values()].map((handler) => ({
      ...handler.descriptor,
      handlerName: handler.constructor.name,
    }));
  }

  private rebuildRegistry(): void {
    this.handlersByType.clear();

    for (const handler of this.handlers) {
      this.registerHandler(handler, { allowReservedCoreType: true });
    }

    for (const handler of this.pluginHandlers) {
      this.registerHandler(handler, { allowReservedCoreType: false });
    }

    const missingTypes = CORE_SPECIAL_STEP_TYPES.filter(
      (type) => !this.handlersByType.has(type),
    );

    if (missingTypes.length > 0) {
      throw new MissingSpecialStepHandlerRegistrationError([...missingTypes]);
    }
  }

  private registerHandler(
    handler: ISpecialStepHandler,
    options: { allowReservedCoreType: boolean },
  ): void {
    const handlerName = handler.constructor.name;
    const type = handler.type;

    const isAllowedCoreType =
      options.allowReservedCoreType &&
      (CORE_SPECIAL_STEP_TYPES as readonly string[]).includes(type);

    if (isReservedSpecialStepType(type) && !isAllowedCoreType) {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName,
        type,
        descriptor: handler.descriptor,
        reason: `reserved type '${type}'`,
      });
    }

    const descriptor = handler.descriptor;
    if (!descriptor) {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName,
        type,
        reason: 'descriptor is missing',
      });
    }

    if (descriptor.type !== type) {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName,
        type,
        descriptor,
        reason: `descriptor.type '${descriptor.type}' does not match handler.type '${type}'`,
      });
    }

    if (descriptor.inputContract.trim().length === 0) {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName,
        type,
        descriptor,
        reason: 'descriptor.inputContract must be non-empty',
      });
    }

    const existing = this.handlersByType.get(type);
    if (existing) {
      throw new DuplicateSpecialStepHandlerRegistrationError({
        type,
        existingHandlerName: existing.constructor.name,
        duplicateHandlerName: handlerName,
      });
    }

    this.handlersByType.set(type, handler);
  }

  private validatePluginHandler(handler: ISpecialStepHandler): void {
    const handlerName = handler.constructor.name;
    const descriptor = handler.descriptor;

    if (!descriptor) {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName,
        type: handler.type,
        reason: 'descriptor is missing',
      });
    }

    if (descriptor.owningDomain !== 'plugin') {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName,
        type: handler.type,
        descriptor,
        reason: "plugin handler descriptor.owningDomain must be 'plugin'",
      });
    }

    if (
      typeof descriptor.pluginId === 'string' &&
      descriptor.pluginId.trim().length > 0
    ) {
      return;
    }

    throw new InvalidSpecialStepHandlerRegistrationError({
      handlerName,
      type: handler.type,
      descriptor,
      reason: 'plugin handler descriptor.pluginId must be non-empty',
    });
  }

  private validatePluginHandlerTypeIsNotCoreDuplicate(
    handler: ISpecialStepHandler,
  ): void {
    if (isReservedSpecialStepType(handler.type)) {
      throw new InvalidSpecialStepHandlerRegistrationError({
        handlerName: handler.constructor.name,
        type: handler.type,
        descriptor: handler.descriptor,
        reason: `reserved type '${handler.type}'`,
      });
    }

    const existing = this.handlers.find(
      (registeredHandler) => registeredHandler.type === handler.type,
    );

    if (!existing) {
      return;
    }

    throw new DuplicateSpecialStepHandlerRegistrationError({
      type: handler.type,
      existingHandlerName: existing.constructor.name,
      duplicateHandlerName: handler.constructor.name,
    });
  }
}
