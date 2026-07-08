import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { IAMPolicyService } from '../security/iam-policy.service';

/**
 * Composition-root startup orchestration. Refreshing the IAM policy cache is
 * the only startup action that needs SecurityModule, so it lives here (run on
 * onApplicationBootstrap, after DatabaseModule.onModuleInit has seeded policy
 * data) instead of inside StartupSeedService — that keeps the persistence-layer
 * seed path free of any SecurityModule dependency and breaks the
 * DatabaseModule <-> SecurityModule cycle. Data seeding itself stays in
 * DatabaseModule.onModuleInit so it completes before any consumer's
 * onModuleInit reads seeded rows.
 *
 * Note: IAMPolicyService also self-refreshes in its own onApplicationBootstrap,
 * so this call is a defensive, idempotent composition-root seam (a second
 * findAll() of agent profiles), not the sole refresh path. BootstrapModule is
 * retained rather than inlined because its early import of SecurityModule also
 * stabilises NestJS module-scan ordering for the order-fragile
 * Security <-> Authorization <-> SystemSettings forwardRef cluster (an accepted
 * remaining cycle — see ADR-0001).
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly iamPolicyService: IAMPolicyService) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.debug('BootstrapService: refreshing IAM policies...');
    await this.iamPolicyService.refreshPolicies();
    this.logger.debug('BootstrapService: bootstrap complete.');
  }
}
