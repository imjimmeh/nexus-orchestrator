// apps/web/src/pages/audit/AuditEventDetail.tsx
import type { AuditLogEntry } from "@/lib/api/client.audit.types";

interface AuditEventDetailProps {
  entry: AuditLogEntry;
}

export function AuditEventDetail({ entry }: AuditEventDetailProps) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/50 p-4 text-sm">
      <span className="text-muted-foreground">Time</span>
      <span>{new Date(entry.createdAt).toLocaleString()}</span>
      <span className="text-muted-foreground">Event</span>
      <span className="font-mono text-xs">{entry.eventType}</span>
      <span className="text-muted-foreground">User</span>
      <span>{entry.userEmail}</span>
      {entry.targetUserEmail && (
        <>
          <span className="text-muted-foreground">Target user</span>
          <span>{entry.targetUserEmail}</span>
        </>
      )}
      {entry.roleName && (
        <>
          <span className="text-muted-foreground">Role</span>
          <span>{entry.roleName}</span>
        </>
      )}
      <span className="text-muted-foreground">Scope</span>
      <span>
        {entry.scopeNodeName}{" "}
        <span className="text-muted-foreground text-xs">
          ({entry.scopeNodeId})
        </span>
      </span>
      {entry.inheritedBy && entry.inheritedBy.length > 0 && (
        <>
          <span className="text-muted-foreground">Inherited by</span>
          <span>{entry.inheritedBy.join(", ")}</span>
        </>
      )}
      {Object.keys(entry.metadata).length > 0 && (
        <>
          <span className="text-muted-foreground">Metadata</span>
          <pre className="overflow-auto rounded bg-background/60 p-2 text-xs">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
