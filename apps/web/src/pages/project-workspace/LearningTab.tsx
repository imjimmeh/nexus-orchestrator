import {
  useRunLearningMemorySweep,
  useLearningMemoryStatus,
} from "@/hooks/useLearningMemory";
import { useMemoryMetrics } from "@/hooks/useMemoryMetrics";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { LearningHealthPanel } from "./LearningHealthPanel";
import { LearningTabCandidatesCard } from "./LearningTabCandidatesCard";
import { LearningTabProposalsPointerCard } from "./LearningTabProposalsPointerCard";
import { LearningTabStatusCard } from "./LearningTabStatusCard";

async function runLearningSweep(
  runSweepMutation: ReturnType<typeof useRunLearningMemorySweep>,
  toast: ReturnType<typeof useToast>,
) {
  try {
    const result = await runSweepMutation.mutateAsync();
    toast.success(
      "Learning sweep completed",
      `Promoted ${result.promotedCandidates.toString()} candidates and generated ${result.createdSkillProposals.toString()} proposals.`,
    );
  } catch (error) {
    toast.error(
      "Learning sweep failed",
      getApiErrorMessage(error, "Unable to run memory learning sweep."),
    );
  }
}

export function LearningTab() {
  const toast = useToast();
  const statusQuery = useLearningMemoryStatus();
  const metricsQuery = useMemoryMetrics();
  const runSweepMutation = useRunLearningMemorySweep();

  return (
    <div className="space-y-4">
      <LearningTabStatusCard
        status={statusQuery.data}
        isLoading={statusQuery.isLoading}
        isRunningSweep={runSweepMutation.isPending || !!statusQuery.data?.sweepRunning}
        onRunSweep={() => {
          void runLearningSweep(runSweepMutation, toast);
        }}
      />

      <LearningHealthPanel
        learning={metricsQuery.data?.learning}
        isLoading={metricsQuery.isLoading}
      />

      <LearningTabCandidatesCard />

      <LearningTabProposalsPointerCard />
    </div>
  );
}
