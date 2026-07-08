import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SettingsTabErrorCardProps {
  onRetry: () => void;
}

export function SettingsTabErrorCard({
  onRetry,
}: Readonly<SettingsTabErrorCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-destructive">
          Failed to load project settings. Refresh the page or retry after
          checking your permissions.
        </p>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}