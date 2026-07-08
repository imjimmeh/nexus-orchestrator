import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffectiveVariables } from "@/hooks/useScopedVariables";

/**
 * Displays the fully-resolved ("effective") variable set for a given scope,
 * annotating each entry with the layer (global or project) that supplied it.
 */
export function EffectiveConfigInspector({
  scopeId,
}: Readonly<{ scopeId: string | null }>) {
  const { data, isLoading } = useEffectiveVariables(scopeId);

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Loading effective config…
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Effective Configuration</CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-sm text-muted-foreground">
          No effective variables defined.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Effective Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.map((entry) => (
          <div
            key={entry.key}
            className="flex items-center justify-between gap-4 border-b py-1 text-sm"
          >
            <span className="font-mono">{entry.key}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-muted-foreground">
                {JSON.stringify(entry.value)}
              </span>
              <Badge variant="outline">
                {entry.layer === "global" ? "global" : "project"}
              </Badge>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
