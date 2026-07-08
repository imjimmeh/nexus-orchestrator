import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { StepCommandModel } from "./step-command-model.types";

export type { StepCommandModel } from "./step-command-model.types";

interface Acc {
  stepId: string;
  command: string;
  chunks: { seq: number; chunk: string }[];
  tail: string;
  status: "running" | "exited" | "timed_out";
  exitCode: number | null;
  order: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function buildStepCommandModels(
  events: WorkflowTelemetryEvent[],
): StepCommandModel[] {
  const byStep = new Map<string, Acc>();
  let order = 0;

  const get = (stepId: string): Acc => {
    let acc = byStep.get(stepId);
    if (!acc) {
      acc = {
        stepId,
        command: "",
        chunks: [],
        tail: "",
        status: "running",
        exitCode: null,
        order: order++,
      };
      byStep.set(stepId, acc);
    }
    return acc;
  };

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    const stepId = str(p.stepId);
    if (!stepId) continue;
    if (event.event_type === "command_started") {
      get(stepId).command = str(p.command);
    } else if (event.event_type === "command_output") {
      get(stepId).chunks.push({ seq: num(p.seq) ?? 0, chunk: str(p.chunk) });
    } else if (event.event_type === "command_finished") {
      const acc = get(stepId);
      acc.tail = str(p.outputTail);
      acc.exitCode = num(p.exitCode);
      acc.status = p.timedOut === true ? "timed_out" : "exited";
    }
  }

  return [...byStep.values()]
    .sort((a, b) => a.order - b.order)
    .map((acc) => {
      const live = [...acc.chunks]
        .sort((a, b) => a.seq - b.seq)
        .map((c) => c.chunk)
        .join("");
      return {
        stepId: acc.stepId,
        command: acc.command,
        output: live.length > 0 ? live : acc.tail,
        status: acc.status,
        exitCode: acc.exitCode,
      };
    });
}
