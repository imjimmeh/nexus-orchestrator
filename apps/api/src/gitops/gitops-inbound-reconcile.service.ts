import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isGitOpsSyncableObjectType } from '@nexus/core';
import { reconcileKey } from './gitops.constants';
import { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import { GitOpsReconcileRunRepository } from './database/repositories/gitops-reconcile-run.repository';
import { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import { GitOpsDesiredStateService } from './gitops-desired-state.service';
import { GitOpsObjectRegistryService } from './objects/gitops-object-registry.service';
import { ReconciliationDiffService } from './reconciliation-diff.service';
import { ReconciliationApplyService } from './reconciliation-apply.service';
import type {
  ActualObject,
  ActualState,
  DesiredObject,
  DesiredState,
  ReconciliationPlan,
} from './reconciliation.types';
import type { ApplyResult } from './reconciliation-apply.service.types';

interface InboundActorContext {
  actorId: string;
}

interface BindingPlanContext {
  binding: GitOpsRepositoryBinding;
  plan: ReconciliationPlan;
  desiredObjects: Map<string, Record<string, unknown>>;
  actualObjects: Map<string, ActualObject>;
}

@Injectable()
export class GitOpsInboundReconcileService {
  constructor(
    private readonly bindings: GitOpsRepositoryBindingRepository,
    private readonly desiredState: GitOpsDesiredStateService,
    private readonly registry: GitOpsObjectRegistryService,
    private readonly diff: ReconciliationDiffService,
    private readonly applier: ReconciliationApplyService,
    private readonly runs: GitOpsReconcileRunRepository,
    private readonly pendingChanges: GitOpsPendingChangeRepository,
  ) {}

  async validate(
    scopeNodeId: string,
    bindingId: string,
    actor: InboundActorContext,
  ): Promise<{ bindingId: string; objectCount: number }> {
    await this.requireBinding(scopeNodeId, bindingId);
    const desired = await this.desiredState.loadForBinding(bindingId, actor);
    return { bindingId, objectCount: desired.objects.length };
  }

  async plan(
    scopeNodeId: string,
    bindingId: string,
    actor: InboundActorContext,
  ): Promise<ReconciliationPlan> {
    const planContext = await this.buildPlan(scopeNodeId, bindingId, actor);
    await this.runs.create({
      bindingId,
      direction: 'inbound',
      status: 'planned',
      revision: planContext.binding.defaultRef,
      summary: JSON.stringify(planContext.plan.summary),
      errors: [],
      startedAt: new Date(),
      finishedAt: new Date(),
      actorUserId: actor.actorId,
    });
    return planContext.plan;
  }

  async apply(
    scopeNodeId: string,
    bindingId: string,
    actor: InboundActorContext,
  ): Promise<ApplyResult> {
    const run = await this.runs.create({
      bindingId,
      direction: 'inbound',
      status: 'applying',
      revision: 'pending',
      summary: null,
      errors: [],
      startedAt: new Date(),
      finishedAt: null,
      actorUserId: actor.actorId,
    });

    try {
      const planContext = await this.buildPlan(scopeNodeId, bindingId, actor);
      const conflicts = planContext.plan.changes.filter(
        (change) => change.conflict,
      );
      if (conflicts.length > 0) {
        throw new BadRequestException('GitOps plan has conflicts');
      }

      const result = await this.applier.apply(planContext.plan, {
        actorId: actor.actorId,
        dryRun: false,
        desiredObjects: planContext.desiredObjects,
        actualObjects: planContext.actualObjects,
        bindingId,
        conflictPolicy: planContext.binding.conflictPolicy,
      });

      await this.bindings.update(bindingId, {
        lastAppliedRevision: planContext.binding.defaultRef,
      });
      await this.runs.update(run.id, {
        status: 'applied',
        revision: planContext.binding.defaultRef,
        summary: JSON.stringify(planContext.plan.summary),
        finishedAt: new Date(),
      });
      return result;
    } catch (error) {
      await this.runs.update(run.id, {
        status: 'failed',
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        finishedAt: new Date(),
      });
      throw error;
    }
  }

  private async buildPlan(
    scopeNodeId: string,
    bindingId: string,
    actor: InboundActorContext,
  ): Promise<BindingPlanContext> {
    const binding = await this.requireBinding(scopeNodeId, bindingId);
    // Milestone-2 call chain (inbound git fetch/clone):
    //   GitOpsInboundReconcileService.buildPlan
    //     -> GitOpsDesiredStateService.loadForBinding
    //       -> DesiredStateLoaderService.load
    //         -> GitOpsInvocationBuilder.build (resolves
    //            credentials + writes SSH key temp file)
    //           -> GitCommandService.exec
    // `GitOpsCredentialsResolver` is injected into
    // `GitOpsInvocationBuilder`, NOT directly into this
    // service, so the inbound reconcile service does not need
    // a constructor change. Strict-mode errors raised by the
    // resolver surface here as a `CredentialResolutionError`
    // propagated from the loader.
    const desired = await this.desiredState.loadForBinding(bindingId, actor);
    const handlers = this.registry.getHandlersForBinding(binding);
    const handlerByType = new Map(
      handlers.map((handler) => [handler.objectType, handler]),
    );
    const desiredObjects: DesiredObject[] = [];
    for (const object of desired.objects) {
      if (!isGitOpsSyncableObjectType(object.type)) {
        continue;
      }

      const handler = handlerByType.get(object.type);
      if (!handler) {
        continue;
      }

      const normalized = handler.normalizeDesired({
        objectType: object.type,
        key: object.key,
        fields: object.fields,
      });
      desiredObjects.push({
        type: normalized.objectType,
        key: normalized.key,
        fields: normalized.fields,
      });
    }

    const normalizedDesired: DesiredState = {
      prune: desired.prune,
      objects: desiredObjects,
    };

    const actualObjects: ActualObject[] = [];
    for (const handler of handlers) {
      const rows = await handler.readActual(binding.scopeNodeId);
      for (const row of rows) {
        actualObjects.push({
          type: row.objectType,
          key: row.key,
          fields: row.fields,
          managedBy: row.managedBy,
          locked: row.locked,
        });
      }
    }

    const actual: ActualState = { objects: actualObjects };
    const pending = await this.pendingChanges.findByBindingId(bindingId);
    const plan = this.diff.computePlan(normalizedDesired, actual, {
      pendingChanges: pending,
      lastAppliedRevision: binding.lastAppliedRevision,
    });

    return {
      binding,
      plan,
      desiredObjects: new Map(
        normalizedDesired.objects.map((object) => [
          reconcileKey(object.type, object.key),
          object.fields,
        ]),
      ),
      actualObjects: new Map(
        actual.objects.map((object) => [
          reconcileKey(object.type, object.key),
          object,
        ]),
      ),
    };
  }

  private async requireBinding(
    scopeNodeId: string,
    bindingId: string,
  ): Promise<GitOpsRepositoryBinding> {
    const binding = await this.bindings.findById(bindingId);
    if (!binding || binding.scopeNodeId !== scopeNodeId) {
      throw new NotFoundException(
        `GitOps repository binding ${bindingId} not found`,
      );
    }
    if (!binding.enabled) {
      throw new BadRequestException(
        `GitOps repository binding ${bindingId} is disabled`,
      );
    }
    return binding;
  }
}
