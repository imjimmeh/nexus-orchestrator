export interface ContainerFreezer {
  freezeContainer(containerId: string): Promise<void>;
}

export interface StepQueueDrainer {
  /** Pause BullMQ workers so no new jobs are pulled during shutdown. */
  pauseAll(): Promise<void>;
}
