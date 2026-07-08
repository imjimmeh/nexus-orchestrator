import { LearningSweepStatus } from "@/lib/api/projects.types";

export interface LearningTabStatusCardProps {
  status: LearningSweepStatus | undefined;
  isLoading: boolean;
  isRunningSweep: boolean;
  onRunSweep: () => void;
}
