import { Injectable } from '@nestjs/common';

import { ServiceLifecyclePhase } from './service-lifecycle-state.service.types';

/**
 * Process-wide lifecycle phase. Watchdogs consult this to suspend reaping
 * while the service is starting up (resume in progress) or shutting down
 * (freeze in progress); dispatch consults it to stop accepting new work.
 */
@Injectable()
export class ServiceLifecycleStateService {
  private currentPhase: ServiceLifecyclePhase = 'booting';

  get phase(): ServiceLifecyclePhase {
    return this.currentPhase;
  }

  markRunning(): void {
    this.currentPhase = 'running';
  }

  markDraining(): void {
    this.currentPhase = 'draining';
  }

  isAcceptingWork(): boolean {
    return this.currentPhase === 'running';
  }

  isReapingSuspended(): boolean {
    return this.currentPhase !== 'running';
  }
}
