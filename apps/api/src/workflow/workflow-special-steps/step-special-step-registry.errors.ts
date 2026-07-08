import type {
  CoreSpecialStepType,
  SpecialStepHandlerDescriptor,
} from './step-special-step.types';

export class SpecialStepHandlerRegistrationError extends Error {
  readonly diagnostics: Record<string, unknown>;

  constructor(message: string, diagnostics: Record<string, unknown>) {
    super(message);
    this.name = SpecialStepHandlerRegistrationError.name;
    this.diagnostics = diagnostics;
  }
}

export class InvalidSpecialStepHandlerRegistrationError extends SpecialStepHandlerRegistrationError {
  constructor(diagnostics: {
    handlerName: string;
    type?: string;
    descriptor?: Partial<SpecialStepHandlerDescriptor>;
    reason: string;
  }) {
    super(
      `Invalid special-step handler registration for ${diagnostics.handlerName}: ${diagnostics.reason}`,
      diagnostics,
    );
    this.name = InvalidSpecialStepHandlerRegistrationError.name;
  }
}

export class DuplicateSpecialStepHandlerRegistrationError extends SpecialStepHandlerRegistrationError {
  constructor(diagnostics: {
    type: string;
    existingHandlerName: string;
    duplicateHandlerName: string;
  }) {
    super(
      `Duplicate special-step handler registration for type '${diagnostics.type}'`,
      diagnostics,
    );
    this.name = DuplicateSpecialStepHandlerRegistrationError.name;
  }
}

export class MissingSpecialStepHandlerRegistrationError extends SpecialStepHandlerRegistrationError {
  readonly missingTypes: CoreSpecialStepType[];

  constructor(missingTypes: CoreSpecialStepType[]) {
    super(
      `Missing required special-step handlers: ${missingTypes.join(', ')}`,
      {
        missingTypes,
      },
    );
    this.name = MissingSpecialStepHandlerRegistrationError.name;
    this.missingTypes = missingTypes;
  }
}
