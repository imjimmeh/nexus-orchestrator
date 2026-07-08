export interface StepCommandModel {
  stepId: string;
  command: string;
  output: string;
  status: "running" | "exited" | "timed_out";
  exitCode: number | null;
}
