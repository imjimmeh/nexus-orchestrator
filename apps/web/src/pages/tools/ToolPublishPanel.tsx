import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToolCandidate, ToolValidationRun } from "@/lib/api/tools.types";

interface ToolPublishPanelProps {
  candidate: ToolCandidate | null;
  latestValidationRun: ToolValidationRun | null;
  onValidate: () => void;
  onPublish: () => void;
  isValidating: boolean;
  isPublishing: boolean;
}

function getStatusVariant(status?: ToolCandidate["status"]) {
  if (status === "validated" || status === "published") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function ToolPublishPanel({
  candidate,
  latestValidationRun,
  onValidate,
  onPublish,
  isValidating,
  isPublishing,
}: Readonly<ToolPublishPanelProps>) {
  if (!candidate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
          <CardDescription>
            Select a candidate to manage lifecycle.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canPublish =
    candidate.status === "validated" &&
    latestValidationRun?.status === "passed";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
        <CardDescription>
          {candidate.tool_name} v{candidate.version}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status</span>
          <Badge variant={getStatusVariant(candidate.status)}>
            {candidate.status}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onValidate} disabled={isValidating}>
            {isValidating ? "Validating..." : "Run Validation"}
          </Button>
          <Button onClick={onPublish} disabled={isPublishing || !canPublish}>
            {isPublishing ? "Publishing..." : "Publish"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
