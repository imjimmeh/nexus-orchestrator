// apps/web/src/pages/settings/EnforcementModeCard.tsx
import { AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useEnforcementModes,
  useSetEnforcementMode,
} from "@/hooks/useEnforcementMode";
import { useToast } from "@/hooks/useToast";
import type { EnforcementMode } from "@/lib/api/client.authz.types";

const ALL_RESOURCES = [
  "workflows",
  "agents",
  "skills",
  "secrets",
  "budgets",
  "roles",
  "users",
  "settings",
  "gitops",
  "audit",
];

const MODE_DESCRIPTIONS: Record<EnforcementMode, string> = {
  audit: "Log only — denials are never enforced",
  warn: "Log + warn — request allowed but logged",
  enforce: "Hard deny — returns 403",
};

export function EnforcementModeCard() {
  const { data: modes = [], isLoading } = useEnforcementModes();
  const setMode = useSetEnforcementMode();
  const toast = useToast();

  const getModeForResource = (resource: string): EnforcementMode =>
    modes.find((m) => m.resource === resource)?.mode ?? "audit";

  const notEnforcedCount = ALL_RESOURCES.filter(
    (r) => getModeForResource(r) !== "enforce",
  ).length;

  const handleChange = async (resource: string, mode: EnforcementMode) => {
    try {
      await setMode.mutateAsync({ resource, mode });
    } catch {
      toast.error(
        "Error",
        `Failed to update enforcement mode for ${resource}.`,
      );
    }
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>RBAC Enforcement Mode</CardTitle>
        <CardDescription>
          Control how permission denials are handled per resource. Roll out
          enforcement gradually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notEnforcedCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {notEnforcedCount} resource{notEnforcedCount > 1 ? "s" : ""} not in
            enforce mode — denials are not enforced.
          </div>
        )}
        <div className="divide-y divide-border rounded-md border">
          {ALL_RESOURCES.map((resource) => {
            const currentMode = getModeForResource(resource);
            return (
              <div
                key={resource}
                className="flex items-center justify-between px-4 py-2"
              >
                <span className="text-sm font-medium">{resource}</span>
                <Select
                  value={currentMode}
                  onValueChange={(v) => {
                    void handleChange(resource, v as EnforcementMode);
                  }}
                  disabled={setMode.isPending}
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["audit", "warn", "enforce"] as EnforcementMode[]).map(
                      (m) => (
                        <SelectItem key={m} value={m}>
                          <span className="text-xs">{m}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {MODE_DESCRIPTIONS[m]}
                          </span>
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
