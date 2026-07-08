import { useState } from "react";
import type { StepCommandModel } from "@/pages/active-session/step-command-model.types";

const STATUS_LABEL: Record<StepCommandModel["status"], string> = {
  running: "running",
  exited: "exited",
  timed_out: "timed out",
};

export function StepCommandCard({ model }: { model: StepCommandModel }) {
  const [collapsed, setCollapsed] = useState(model.status !== "running");
  const statusText =
    model.status === "exited" && model.exitCode !== null
      ? `exit ${model.exitCode}`
      : STATUS_LABEL[model.status];

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left font-mono"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="truncate text-slate-200">$ {model.command}</span>
        <span className="ml-2 shrink-0 text-xs text-slate-400">
          {statusText}
        </span>
      </button>
      {!collapsed && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-slate-700 px-3 py-2 font-mono text-xs text-slate-300">
          {model.output}
        </pre>
      )}
    </div>
  );
}
