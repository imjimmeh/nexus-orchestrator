import { Injectable } from '@nestjs/common';
import { ScopedConfigResolver } from '../../config-resolution/scoped-config-resolver.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';
import type { Workflow } from '../database/entities/workflow.entity';
import type { EffectiveConfig } from '../../config-resolution/effective-config.types';

@Injectable()
export class WorkflowResolutionService {
  constructor(private readonly resolver: ScopedConfigResolver) {}

  resolve(
    name: string,
    scopeNodeId: string | null,
  ): Promise<EffectiveConfig<Workflow>> {
    return this.resolver.resolve<Workflow>(
      'workflow',
      name,
      scopeNodeId ?? GLOBAL_SCOPE_NODE_ID,
    );
  }
}
