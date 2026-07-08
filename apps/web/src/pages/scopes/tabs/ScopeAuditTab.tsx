// apps/web/src/pages/scopes/tabs/ScopeAuditTab.tsx
import { AuditLogTable } from "@/pages/audit/AuditLogTable";

interface ScopeAuditTabProps {
  scopeNodeId: string;
}

export function ScopeAuditTab({ scopeNodeId }: ScopeAuditTabProps) {
  return (
    <div className="pt-4">
      <AuditLogTable lockedScopeNodeId={scopeNodeId} />
    </div>
  );
}
