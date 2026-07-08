import type { ImprovementEvidenceClass } from '@nexus/core';

export interface ImprovementEvidencePayload {
  evidenceClass: ImprovementEvidenceClass;
  runIds?: string[];
  failureClasses?: string[];
  ledgerRefs?: string[];
}
