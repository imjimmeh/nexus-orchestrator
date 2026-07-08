import { AlertCircle } from "lucide-react";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";

function ValidationErrorDisplay() {
  const validationErrors = useWorkflowEditorStore((s) => s.validationErrors);

  const entries = Object.entries(validationErrors);
  if (entries.length === 0) return null;

  const countLabel =
    entries.length === 1
      ? "1 validation error"
      : `${entries.length} validation errors`;

  return (
    <div className="mx-3 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{countLabel}</span>
      </div>
      <ul className="mt-2 space-y-1 text-destructive/80">
        {entries.map(([field, message]) => (
          <li key={field} className="flex gap-2">
            <code className="rounded bg-destructive/20 px-1 text-xs font-mono">
              {field}
            </code>
            <span>{message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { ValidationErrorDisplay };
