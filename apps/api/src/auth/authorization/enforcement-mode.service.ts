import { Injectable } from '@nestjs/common';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  DEFAULT_ENFORCEMENT_MODE,
  ENFORCEMENT_MODE_GLOBAL_KEY,
  coerceEnforcementMode,
  enforcementModeKey,
} from './enforcement-mode';
import type { EnforcementMode } from './enforcement-mode.types';

@Injectable()
export class EnforcementModeService {
  constructor(private readonly settings: SystemSettingsService) {}

  async getMode(resource: string): Promise<EnforcementMode> {
    const SENTINEL = '__unset__';
    const resourceValue = await this.settings.get<string>(
      enforcementModeKey(resource),
      SENTINEL,
    );
    if (resourceValue !== SENTINEL) {
      return coerceEnforcementMode(resourceValue);
    }
    const globalValue = await this.settings.get<string>(
      ENFORCEMENT_MODE_GLOBAL_KEY,
      DEFAULT_ENFORCEMENT_MODE,
    );
    return coerceEnforcementMode(globalValue);
  }
}
