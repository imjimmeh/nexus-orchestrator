import { SessionStatusBadge } from "./SessionStatusBadge";

interface SubagentExecutionRowProps {
  id: string;
  displayStatus: string;
  lastEventName: string;
}

export function SubagentExecutionRow({
  id,
  displayStatus,
  lastEventName,
}: Readonly<SubagentExecutionRowProps>) {
  return (
    <div className="rounded border bg-background px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] break-all">{id}</span>
        <SessionStatusBadge kind="subagent" status={displayStatus} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        last event: {lastEventName}
      </p>
    </div>
  );
}
