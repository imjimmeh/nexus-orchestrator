import { Stethoscope } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DoctorHistoryPanel } from "./DoctorHistoryPanel";
import { DoctorReportPanel } from "./DoctorReportPanel";
import { ResumeSummaryPanel } from "./ResumeSummaryPanel";
import { useDoctorChecks } from "./useDoctorChecks";

/**
 * @file Doctor.tsx
 *
 * Presentation shell for the Doctor Diagnostics page. Health-check polling,
 * repair-mutation, and history pagination are owned by `useDoctorChecks`; each
 * major section (resume summary, current health report, repair history) is
 * composed from a sibling component in this folder.
 */
export function Doctor(): React.JSX.Element {
  const {
    resumeQuery,
    reportQuery,
    historyQuery,
    repairPending,
    argumentsByAction,
    setActionArguments,
    historyLimit,
    historyOffset,
    setHistoryOffset,
    onRunDryRepair,
    onRunLiveRepair,
    confirmLiveRepair,
    liveRepairTarget,
    setLiveRepairTarget,
  } = useDoctorChecks();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Stethoscope className="h-7 w-7" />
          Doctor Diagnostics
        </h2>
        <p className="text-muted-foreground">
          Unified runtime checks, safe repair actions, and repair audit history.
        </p>
      </div>

      <ResumeSummaryPanel resumeQuery={resumeQuery} />

      <DoctorReportPanel
        reportQuery={reportQuery}
        argumentsByAction={argumentsByAction}
        setActionArguments={setActionArguments}
        onRunDryRepair={onRunDryRepair}
        onRunLiveRepair={onRunLiveRepair}
        repairPending={repairPending}
      />

      <DoctorHistoryPanel
        historyQuery={historyQuery}
        historyLimit={historyLimit}
        historyOffset={historyOffset}
        setHistoryOffset={setHistoryOffset}
      />

      <AlertDialog
        open={liveRepairTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLiveRepairTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Live Doctor Repair?</AlertDialogTitle>
            <AlertDialogDescription>
              This will execute a non-dry-run repair action and may mutate
              runtime state. Continue only if you are sure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLiveRepairTarget(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLiveRepair}
              disabled={repairPending}
            >
              Run Repair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
