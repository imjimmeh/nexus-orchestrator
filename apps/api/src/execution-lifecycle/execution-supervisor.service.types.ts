import type { StepSessionCheckpointRepository } from '../workflow/workflow-session-checkpoint/step-session-checkpoint.repository';
import type { ISessionHydrationService } from '../shared/interfaces/session-hydration.interface';

export interface ContainerLivenessProbe {
  isContainerLost(containerId: string): Promise<boolean>;
}

/** Dependencies for checkpoint persistence on reap (optional for backward-compatibility). */
export interface CheckpointPersistenceDeps {
  checkpointRepo: StepSessionCheckpointRepository;
  sessionHydration: ISessionHydrationService;
}
