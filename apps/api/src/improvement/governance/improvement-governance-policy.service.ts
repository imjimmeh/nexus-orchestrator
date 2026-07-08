import { Injectable, Logger } from '@nestjs/common';
import {
  GOVERNANCE_MODES,
  type GovernanceAction,
  type GovernanceMode,
  type ImprovementEvidenceClass,
  type ImprovementProposalKind,
} from '@nexus/core';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  IMPROVEMENT_GOVERNANCE_MODE_DEFAULT,
  IMPROVEMENT_GOVERNANCE_MODE_KEY,
  IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT,
  IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY,
} from './improvement-governance.settings.constants';
import { decideGovernanceAction } from './improvement-governance-policy.helpers';

@Injectable()
export class ImprovementGovernancePolicyService {
  private readonly logger = new Logger(ImprovementGovernancePolicyService.name);

  constructor(private readonly settings: SystemSettingsService) {}

  async resolveAction(input: {
    kind: ImprovementProposalKind;
    evidenceClass: ImprovementEvidenceClass;
    confidence: number;
    provenanceSource?: string;
  }): Promise<GovernanceAction> {
    const mode = await this.readMode();
    const overrides = await this.readOverrides();
    return decideGovernanceAction({ ...input, mode, overrides });
  }

  private async readMode(): Promise<GovernanceMode> {
    try {
      const raw = await this.settings.get<GovernanceMode>(
        IMPROVEMENT_GOVERNANCE_MODE_KEY,
        IMPROVEMENT_GOVERNANCE_MODE_DEFAULT,
      );
      return this.isGovernanceMode(raw)
        ? raw
        : IMPROVEMENT_GOVERNANCE_MODE_DEFAULT;
    } catch (error) {
      this.logger.warn(
        `governance mode read failed; defaulting to ${IMPROVEMENT_GOVERNANCE_MODE_DEFAULT}: ${String(error)}`,
      );
      return IMPROVEMENT_GOVERNANCE_MODE_DEFAULT;
    }
  }

  private async readOverrides(): Promise<
    Partial<Record<ImprovementProposalKind, GovernanceMode>>
  > {
    try {
      const raw = await this.settings.get<Record<string, unknown>>(
        IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY,
        IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT,
      );
      if (!raw || typeof raw !== 'object') {
        return {};
      }
      return this.validateOverrides(raw);
    } catch (error) {
      this.logger.warn(`governance overrides read failed: ${String(error)}`);
      return {};
    }
  }

  /**
   * Drops any per-kind override whose value isn't a recognized
   * `GovernanceMode`, instead of letting corrupted settings data reach
   * `decideGovernanceAction` — there, an unrecognized mode string matches
   * neither the `manual` nor `tiered` branch and falls through to the
   * most-permissive `autonomous` auto-apply branch.
   */
  private validateOverrides(
    raw: Record<string, unknown>,
  ): Partial<Record<ImprovementProposalKind, GovernanceMode>> {
    const validated: Partial<Record<ImprovementProposalKind, GovernanceMode>> =
      {};
    for (const [kind, mode] of Object.entries(raw)) {
      if (this.isGovernanceMode(mode)) {
        validated[kind as ImprovementProposalKind] = mode;
      } else {
        this.logger.warn(
          `dropping unrecognized governance override for kind '${kind}': ${String(mode)}`,
        );
      }
    }
    return validated;
  }

  private isGovernanceMode(value: unknown): value is GovernanceMode {
    return (
      typeof value === 'string' &&
      (GOVERNANCE_MODES as readonly string[]).includes(value)
    );
  }
}
