export interface ContainerResumer {
  getContainerRuntimeState(
    containerId: string,
  ): Promise<'paused' | 'running' | 'stopped' | 'missing'>;
  resumeContainer(containerId: string): Promise<void>;
}

export interface SessionRehydrator {
  /** Re-provision + rehydrate the session for an execution. Returns false if impossible. */
  rehydrateAndResume(executionId: string): Promise<boolean>;
}

export interface ResumeSummary {
  frozenFound: number;
  resumed: number;
  failed: number;
  lastResumeAt: string | null;
}
