import { Injectable } from '@nestjs/common';
import type {
  DriftCategory,
  DriftReport,
  ReconcileOp,
  ReconciliationPlan,
} from './reconciliation.types';

const OP_TO_CATEGORY: Partial<Record<ReconcileOp, DriftCategory>> = {
  create: 'git_only',
  delete: 'db_only',
  update: 'field_divergence',
};

@Injectable()
export class DriftDetectionService {
  classify(plan: ReconciliationPlan): DriftReport {
    let inSync = 0;
    const drifted: DriftReport['drifted'] = [];

    for (const c of plan.changes) {
      if (c.op === 'noop' && !c.skippedReason) {
        // True noop: object matches desired-state exactly.
        inSync += 1;
        continue;
      }
      const category =
        c.op === 'noop'
          ? 'field_divergence' // noop-by-guard: desired diverges but could not be applied
          : OP_TO_CATEGORY[c.op];
      if (category) {
        drifted.push({ type: c.type, key: c.key, category, diff: c.diff });
      }
    }

    return { drifted, inSync };
  }
}
