import { BadRequestException, Injectable } from '@nestjs/common';
import type { GitOpsSyncableObjectType } from '@nexus/core';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';

type GitOpsEditAction = 'allow' | 'allow_with_pending_change' | 'block';

type GitOpsEditDecision = {
  action: GitOpsEditAction;
  reason?: string;
  binding?: GitOpsRepositoryBinding;
};

@Injectable()
export class GitOpsEditPolicyService {
  constructor(private readonly bindings: GitOpsRepositoryBindingRepository) {}

  async evaluateExisting(input: {
    objectType: GitOpsSyncableObjectType;
    managedBy: string | null;
    managedBindingId: string | null;
    locked: boolean;
  }): Promise<GitOpsEditDecision> {
    if (input.managedBy !== 'gitops') {
      return { action: 'allow' };
    }

    if (input.locked) {
      return {
        action: 'block',
        reason: 'GitOps-managed object is locked',
      };
    }

    if (!input.managedBindingId) {
      return {
        action: 'block',
        reason: 'GitOps-managed object is missing repository binding ownership',
      };
    }

    const binding = await this.bindings.findById(input.managedBindingId);
    if (!binding?.enabled) {
      return {
        action: 'block',
        reason: 'GitOps repository binding is disabled or missing',
      };
    }

    if (!binding.includedObjectTypes.includes(input.objectType)) {
      return {
        action: 'block',
        reason: 'GitOps repository binding does not manage this object type',
      };
    }

    return this.decisionForBinding(binding);
  }

  async evaluateCreate(input: {
    objectType: GitOpsSyncableObjectType;
    scopeNodeId: string;
  }): Promise<GitOpsEditDecision> {
    const bindings = await this.bindings.findByScopeNodeId(input.scopeNodeId);
    const managingBindings = bindings.filter(
      (binding) =>
        binding.enabled &&
        binding.includedObjectTypes.includes(input.objectType),
    );

    if (managingBindings.length === 0) {
      return { action: 'allow' };
    }

    const twoWayBinding = managingBindings.find(
      (binding) => binding.syncMode === 'two_way',
    );

    return this.decisionForBinding(twoWayBinding ?? managingBindings[0]);
  }

  assertAllowed(decision: GitOpsEditDecision): void {
    if (decision.action === 'block') {
      throw new BadRequestException(decision.reason ?? 'GitOps edit blocked');
    }
  }

  private decisionForBinding(
    binding: GitOpsRepositoryBinding,
  ): GitOpsEditDecision {
    if (binding.syncMode === 'two_way') {
      return { action: 'allow_with_pending_change', binding };
    }

    return {
      action: 'block',
      binding,
      reason: 'GitOps git-to-app binding blocks app-side edits',
    };
  }
}
