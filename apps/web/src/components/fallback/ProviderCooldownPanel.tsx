import type { ProviderCooldownStatus } from "@nexus/core";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProviderCooldownStatus } from "@/hooks/useProviderCooldownStatus";

const REASON_LABELS: Record<ProviderCooldownStatus["reason"], string> = {
  usage_exhausted: "Usage exhausted",
  billing_exhausted: "Billing exhausted",
  auth_failed: "Auth failed",
  provider_outage: "Provider outage",
};

function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString();
}

function CooldownRow({ status }: Readonly<{ status: ProviderCooldownStatus }>) {
  return (
    <div className="flex items-center justify-between rounded-md border px-4 py-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="font-medium">{status.provider_name}</span>
        <Badge variant="secondary">{REASON_LABELS[status.reason]}</Badge>
      </div>
      <div className="text-right text-muted-foreground">
        <div>Cooled until: {formatDateTime(status.cooled_until)}</div>
        {status.source_run_id && (
          <div className="text-xs">Run: {status.source_run_id}</div>
        )}
      </div>
    </div>
  );
}

export function ProviderCooldownPanel() {
  const { data, isLoading, isError } = useProviderCooldownStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Provider Cooldowns
        </CardTitle>
        <CardDescription>
          Providers currently in cooldown due to recent failures. Refreshes
          every 30 seconds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            Failed to load cooldown status.
          </p>
        )}
        {!isLoading && !isError && data !== undefined && data.length === 0 && (
          <p className="text-sm text-muted-foreground">No active cooldowns.</p>
        )}
        {data && data.length > 0 && (
          <div className="space-y-2">
            {data.map((status) => (
              <CooldownRow key={status.provider_name} status={status} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
