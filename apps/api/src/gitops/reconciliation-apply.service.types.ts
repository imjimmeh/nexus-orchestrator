import type { ActualObject } from './reconciliation.types';

export interface ApplyOptions {
  actorId: string;
  dryRun?: boolean;
  desiredObjects: Map<string, Record<string, unknown>>;
  actualObjects?: Map<string, ActualObject>;
  bindingId?: string;
  conflictPolicy?: string;
}

export interface ApplyResult {
  planned: number;
  applied: number;
  skipped: number;
  dryRun: boolean;
}
