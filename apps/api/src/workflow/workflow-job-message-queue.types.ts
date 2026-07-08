import type { HarnessSessionRef } from '@nexus/core';

export interface ResumeJobOptions {
  jobId?: string;
  resumeSessionRef?: HarnessSessionRef;
}
