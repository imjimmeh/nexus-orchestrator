import type { StateManagerService } from './state-manager.service';

export type AutoRetryStateMutator = Pick<StateManagerService, 'deleteVariable'>;
