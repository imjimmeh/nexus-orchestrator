import { Inject, Injectable } from '@nestjs/common';
import type { ImprovementProposalKind } from '@nexus/core';
import {
  IMPROVEMENT_APPLIERS,
  type IImprovementApplier,
} from './improvement-applier.types';

@Injectable()
export class ImprovementApplierRegistry {
  private readonly byKind = new Map<
    ImprovementProposalKind,
    IImprovementApplier
  >();

  constructor(@Inject(IMPROVEMENT_APPLIERS) appliers: IImprovementApplier[]) {
    for (const applier of appliers) {
      this.registerApplier(applier);
    }
  }

  get(kind: ImprovementProposalKind): IImprovementApplier | undefined {
    return this.byKind.get(kind);
  }

  require(kind: ImprovementProposalKind): IImprovementApplier {
    const applier = this.byKind.get(kind);
    if (!applier) {
      throw new Error(`no applier registered for kind '${kind}'`);
    }
    return applier;
  }

  /**
   * Mirrors `StepSpecialStepRegistryService.registerHandler`'s duplicate
   * guard: a second applier claiming an already-registered `kind` is a
   * wiring bug, not a last-write-wins override, so it must fail loudly
   * instead of silently masking one of the two appliers.
   */
  private registerApplier(applier: IImprovementApplier): void {
    const existing = this.byKind.get(applier.kind);
    if (existing) {
      throw new Error(
        `Duplicate improvement applier registration for kind '${applier.kind}' ` +
          `(existing: ${existing.constructor.name}, duplicate: ${applier.constructor.name})`,
      );
    }
    this.byKind.set(applier.kind, applier);
  }
}
